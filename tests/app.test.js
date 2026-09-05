'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const LoanCalculator = require('../js/calculations');
const script = readFileSync(require.resolve('../js/app.js'), 'utf8');
const markup = readFileSync(require.resolve('../index.html'), 'utf8');
const key = 'amortization-scheduler:v2';

// Minimal DOM/storage doubles for application wiring, not browser layout tests.
function app(saved = {}, blocked = false) {
    class Element {
        constructor() { this.children = []; this.handlers = {}; this.value = ''; this.hidden = false; }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute() {}
        addEventListener(name, handler) { this.handlers[name] = handler; }
        focus() {}
        reportValidity() { return true; }
        reset() { elements['change-type'].value = 'ONE_TIME'; radios.REDUCE_TENURE.checked = true; elements['change-value'].value = ''; }
        trigger(name) { this.handlers[name]({ preventDefault() {} }); }
    }
    const elements = Object.fromEntries([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
    const badge = new Element();
    let effect = 'REDUCE_TENURE';
    const radios = Object.fromEntries(['REDUCE_TENURE', 'REDUCE_EMI'].map(value => [value, {
        value, set checked(checked) { if (checked) effect = value; }, get checked() { return effect === value; }
    }]));
    const data = new Map(Object.entries(saved));
    const storage = {
        getItem(name) { if (blocked) throw new Error('Storage blocked'); return data.get(name) ?? null; },
        setItem(name, value) { if (blocked) throw new Error('Storage blocked'); data.set(name, value); }
    };
    const document = {
        getElementById: name => elements[name], createElement: () => new Element(), createDocumentFragment: () => new Element(),
        querySelector(selector) {
            if (selector === '.local-badge') return badge;
            if (selector.endsWith(':checked')) return radios[effect];
            const match = /value="([^"]+)"/.exec(selector);
            return radios[match[1]];
        }
    };
    let counter = 0;
    vm.runInNewContext(script, { document, localStorage: storage, LoanCalculator, console, Date, confirm: () => true,
        crypto: { randomUUID: () => `test-${++counter}` } });
    return { elements, data, radios, badge };
}

test('original jStorage loan and prepayments load with tenure reduction', () => {
    const legacy = { pa: 100000, roi: 11, nom: 240, yy: 2026, mm: 0, dd: 31,
        pp: [{ id: 'old', dateOfChange: new Date(2026, 1, 20).toISOString(), typeOfChange: 'ONE_TIME', valueOfChange: '20000' }] };
    const { elements, data } = app({ jStorage: JSON.stringify(legacy) });
    assert.equal(elements.startDate.value, '2026-01-31');
    assert.equal(elements['row-count'].textContent, '138 installments');
    elements['loan-form'].trigger('submit');
    const saved = JSON.parse(data.get(key));
    assert.equal(saved.changes[0].effect, 'REDUCE_TENURE');
    assert.equal(saved.changes[0].date, '2026-02-20');
    assert.equal(data.get('jStorage'), JSON.stringify(legacy));
});

test('add, edit and remove refresh the schedule and persist immediately', () => {
    const { elements, data, radios } = app();
    elements.startDate.value = '2026-01-31';
    elements['change-date'].value = '2026-02-20';
    elements['change-value'].value = '20000';
    radios.REDUCE_EMI.checked = true;
    elements['change-form'].trigger('submit');
    assert.equal(elements['row-count'].textContent, '240 installments');
    assert.equal(JSON.parse(data.get(key)).changes[0].effect, 'REDUCE_EMI');
    const buttons = elements['change-list'].children[0].children[1].children;
    buttons[0].trigger('click');
    assert.equal(elements['save-change'].textContent, 'Save change');
    radios.REDUCE_TENURE.checked = true;
    elements['change-form'].trigger('submit');
    assert.equal(elements['row-count'].textContent, '138 installments');
    assert.equal(JSON.parse(data.get(key)).changes.length, 1);
    elements['change-list'].children[0].children[1].children[1].trigger('click');
    assert.equal(elements['row-count'].textContent, '240 installments');
    assert.deepEqual(JSON.parse(data.get(key)).changes, []);
});

test('versioned saved state is restored, and reset leaves other storage untouched', () => {
    const state = { loan: { principal: 1200, annualRate: 0, months: 12, startDate: '2026-01-01' }, changes: [] };
    const { elements, data } = app({ [key]: JSON.stringify(state), unrelated: 'keep me' });
    assert.equal(elements['row-count'].textContent, '12 installments');
    elements.reset.trigger('click');
    assert.equal(elements['row-count'].textContent, '240 installments');
    assert.equal(data.get('unrelated'), 'keep me');
});

test('corrupt or structurally invalid saved data falls back without overwriting it', () => {
    for (const saved of ['invalid JSON', '{}', '{"changes":null}']) {
        const { elements, data } = app({ [key]: saved });
        assert.equal(elements.results.hidden, false);
        assert.equal(elements['storage-note'].hidden, false);
        assert.equal(data.get(key), saved);
    }
});

test('blocked storage does not prevent calculation', () => {
    const { elements, badge } = app({}, true);
    elements['loan-form'].trigger('submit');
    assert.equal(elements.results.hidden, false);
    assert.equal(elements['storage-note'].hidden, false);
    assert.equal(badge.textContent, 'Device storage unavailable');
});

test('invalid loan input hides stale results without overwriting saved values', () => {
    const { elements, data } = app();
    elements['loan-form'].trigger('submit');
    const saved = data.get(key);
    elements.months.value = '-1';
    elements['loan-form'].trigger('change');
    assert.equal(elements.results.hidden, true);
    assert.equal(elements.error.hidden, false);
    assert.equal(data.get(key), saved);
});
