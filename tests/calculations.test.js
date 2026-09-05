'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../js/calculations');

const loan = { principal: 100000, annualRate: 11, months: 240, startDate: '2026-01-31' };
const prepay = (value, effect = 'REDUCE_TENURE', date = '2026-02-20') => ({ date, type: 'ONE_TIME', value, effect });
const change = (type, value, date = '2026-02-20') => ({ date, type, value });

function reconciles(result, principal) {
    assert.equal(result.rows.at(-1).balance, 0);
    assert.equal(result.totalPaid - result.totalInterest, Math.round(principal * 100));
    assert.equal(result.rows.reduce((sum, row) => sum + row.principal, 0), Math.round(principal * 100));
    assert.equal(result.rows.reduce((sum, row) => sum + row.interest, 0), result.totalInterest);
    assert.equal(result.rows.reduce((sum, row) => sum + row.emi + row.prepayment, 0), result.totalPaid);
    let opening = Math.round(principal * 100);
    for (const row of result.rows) {
        assert.equal(row.openingBalance, opening);
        assert.equal(row.openingBalance + row.interest - row.emi - row.prepayment, row.balance);
        for (const field of ['emi', 'prepayment', 'interest', 'principal', 'balance']) {
            assert(Number.isSafeInteger(row[field]), `${field} is an integer minor-unit amount`);
            assert(row[field] >= 0, `${field} is not negative`);
        }
        opening = row.balance;
    }
}

test('default loan finishes at 240 months with no phantom final row', () => {
    const result = calculate(loan);
    assert.equal(result.rows.length, 240);
    assert.equal(result.initialEmi, 103219);
    assert.equal(result.interestSaved, 0);
    reconciles(result, loan.principal);
});

test('zero interest divides principal and settles rounding in the last installment', () => {
    const result = calculate({ ...loan, principal: 100, annualRate: 0, months: 3 });
    assert.deepEqual(result.rows.map(row => row.emi), [3333, 3333, 3334]);
    assert.equal(result.totalInterest, 0);
    reconciles(result, 100);
});

test('exact one-month payoff retains all financial fields', () => {
    const result = calculate({ ...loan, principal: 1000, annualRate: 12, months: 1 });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].emi, 101000);
    assert.equal(result.rows[0].interest, 1000);
    reconciles(result, 1000);
});

test('oversized prepayment is capped, with excess explicitly reported', () => {
    const result = calculate(loan, [prepay(150000, 'REDUCE_TENURE', '2026-01-31')]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.totalPaid, 10091667);
    assert.equal(result.rows[0].prepayment, 9988448);
    assert.equal(result.rows[0].unusedPrepayment, 5011552);
    reconciles(result, loan.principal);
});

test('reduce tenure keeps EMI and reduces both term and interest', () => {
    const result = calculate(loan, [prepay(20000)]);
    assert.equal(result.rows.length, 138);
    assert(result.rows.slice(0, -1).every(row => row.emi === result.initialEmi));
    assert(result.interestSaved > 0);
    reconciles(result, loan.principal);
});

test('reduce EMI starts next month and preserves payoff date', () => {
    const result = calculate(loan, [prepay(20000, 'REDUCE_EMI')]);
    assert.equal(result.rows.length, 240);
    assert.equal(result.payoffDate, calculate(loan).payoffDate);
    assert.equal(result.rows[1].emi, 103219);
    assert.equal(result.rows[2].emi, 82527);
    assert(result.interestSaved > 0);
    reconciles(result, loan.principal);
});

test('later EMI reduction preserves a term already shortened by prepayment', () => {
    const first = prepay(20000);
    const shortened = calculate(loan, [first]);
    const result = calculate(loan, [first, prepay(10000, 'REDUCE_EMI', '2026-06-01')]);
    assert.equal(result.payoffDate, shortened.payoffDate);
    assert(result.rows[5].nextEmi < result.rows[5].emi);
    reconciles(result, loan.principal);
});

test('a tiny prepayment cannot extend the original term through rounding', () => {
    const result = calculate(loan, [prepay(0.01)]);
    assert(result.rows.length <= loan.months);
    reconciles(result, loan.principal);
});

test('month-end dates clamp without skipping February or applying changes twice', () => {
    const result = calculate(loan, [prepay(100)]);
    assert.deepEqual(result.rows.slice(0, 4).map(row => row.date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    assert.equal(result.totalPrepayment, 10000);
    const leap = calculate({ ...loan, startDate: '2028-01-31' });
    assert.equal(leap.rows[1].date, '2028-02-29');
});

test('changes within a month use date order regardless of entry order', () => {
    const changes = [change('ROI_CHANGE', 9, '2026-03-25'), change('ROI_CHANGE', 8, '2026-03-02'), prepay(1000, 'REDUCE_EMI', '2026-03-12')];
    const result = calculate(loan, changes);
    assert.equal(result.rows[2].annualRate, 9);
    assert.deepEqual(result, calculate(loan, changes.toReversed()));
    reconciles(result, loan.principal);
});

test('same-month prepayments combine and support mixed effects', () => {
    const result = calculate(loan, [prepay(1000), prepay(2000, 'REDUCE_EMI', '2026-02-21')]);
    assert.equal(result.rows[1].prepayment, 300000);
    assert.equal(result.payoffDate, calculate(loan, [prepay(1000)]).payoffDate);
    reconciles(result, loan.principal);
});

test('manual EMI changes take effect in the selected month', () => {
    const result = calculate(loan, [change('EMI_CHANGE', 1500)]);
    assert.equal(result.rows[1].emi, 150000);
    assert(result.rows.length < loan.months);
    reconciles(result, loan.principal);
});

test('rate changes can add cost, which remains a negative saving', () => {
    const result = calculate({ ...loan, months: 120 }, [change('ROI_CHANGE', 12)]);
    assert(result.interestSaved < 0);
    reconciles(result, loan.principal);
});

test('changing rate to zero keeps calculations finite', () => {
    const result = calculate(loan, [change('ROI_CHANGE', 0), prepay(20000, 'REDUCE_EMI')]);
    assert(result.rows.slice(1).every(row => row.interest === 0));
    reconciles(result, loan.principal);
});

test('unchanged rate and EMI do not extend the schedule', () => {
    const result = calculate(loan, [change('ROI_CHANGE', 11), change('EMI_CHANGE', 1032.19)]);
    assert.equal(result.rows.length, 240);
});

test('insufficient EMI fails promptly instead of looping', () => {
    assert.throws(() => calculate(loan, [change('EMI_CHANGE', 100)]), /does not cover/);
    assert.throws(() => calculate(loan, [change('ROI_CHANGE', 100)]), /does not cover/);
});

test('changes after payoff are counted as unapplied', () => {
    const result = calculate(loan, [prepay(150000), prepay(1000, 'REDUCE_EMI', '2049-01-01')]);
    assert.equal(result.ignoredChanges, 1);
    reconciles(result, loan.principal);
});

test('legacy prepayments default to reduce tenure and do not mutate input', () => {
    const event = change('ONE_TIME', 20000);
    const snapshot = JSON.stringify(event);
    assert.deepEqual(calculate(loan, [event]), calculate(loan, [prepay(20000)]));
    assert.equal(JSON.stringify(event), snapshot);
});

test('invalid amounts, tenure, rates, dates and changes are rejected', () => {
    for (const invalid of [{ principal: -1 }, { principal: 0 }, { principal: Infinity }, { months: 0 }, { months: 1.5 }, { months: 1201 }, { annualRate: -1 }, { annualRate: '' }, { startDate: '2026-02-30' }]) {
        assert.throws(() => calculate({ ...loan, ...invalid }));
    }
    assert.throws(() => calculate(loan, [prepay(100, 'REDUCE_EMI', '2025-12-01')]), /before/);
    assert.throws(() => calculate(loan, [prepay(-100)]));
    assert.throws(() => calculate(loan, [prepay(100, 'INVALID')]));
});

test('rounding reconciles across a range of principals, rates and prepayment modes', () => {
    for (const principal of [0.01, 1234.56, 2500000]) {
        for (const annualRate of [0, 0.000001, 6.75, 11]) {
            for (const months of [1, 12, 240]) {
                const input = { ...loan, principal, annualRate, months };
                reconciles(calculate(input), principal);
                for (const effect of ['REDUCE_TENURE', 'REDUCE_EMI']) {
                    reconciles(calculate(input, [prepay(Math.max(0.01, principal / 5), effect, '2026-01-31')]), principal);
                }
            }
        }
    }
});
