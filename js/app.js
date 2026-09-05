(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const storageKey = 'amortization-scheduler:v2';
    const numberFormatKey = 'amortization-scheduler:number-format';
    const formatter = locale => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let moneyFormatter = formatter('en-US');
    const money = cents => moneyFormatter.format(cents / 100);
    const formatDate = value => {
        const { year, month, day } = LoanCalculator.parseDate(value);
        return new Date(year, month - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const defaults = () => ({ principal: 100000, annualRate: 11, months: 240, startDate: localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) });
    let changes = [], editingId = null;
    const loanFields = ['principal', 'annualRate', 'months', 'startDate'];
    const readLoan = () => Object.fromEntries(loanFields.map(key => [key, $(key).value]));
    const fillLoan = loan => loanFields.forEach(key => { $(key).value = loan[key]; });
    const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    function storageNotice(message, badge = 'Device storage unavailable') {
        $('storage-note').textContent = message;
        $('storage-note').hidden = false;
        document.querySelector('.local-badge').textContent = badge;
    }

    function loadNumberFormat() {
        let locale = 'en-US';
        try {
            if (localStorage.getItem(numberFormatKey) === 'en-IN') locale = 'en-IN';
        } catch (error) {
            // The loan loader reports unavailable storage; formatting still works.
        }
        $('number-format').value = locale;
        moneyFormatter = formatter(locale);
    }

    function load() {
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved) {
                const state = JSON.parse(saved);
                if (!state || !Array.isArray(state.changes)) throw new Error('Invalid saved changes.');
                LoanCalculator.calculate(state.loan, state.changes);
                changes = state.changes;
                return state.loan;
            }
            // Read the original app's jStorage data without loading its old libraries.
            const legacy = JSON.parse(localStorage.getItem('jStorage') || '{}');
            if (legacy.pa !== undefined) {
                const loan = { principal: legacy.pa, annualRate: legacy.roi, months: legacy.nom,
                    startDate: localDate(new Date(legacy.yy, legacy.mm, legacy.dd)) };
                const restored = (legacy.pp || []).map(change => ({ id: change.id || id(), date: localDate(new Date(change.dateOfChange)),
                    type: change.typeOfChange, value: change.valueOfChange, effect: 'REDUCE_TENURE' }));
                LoanCalculator.calculate(loan, restored);
                changes = restored;
                return loan;
            }
        } catch (error) {
            storageNotice('Saved data could not be loaded. Defaults are shown; your previous saved data has not been changed.', 'Saved data not loaded');
        }
        return defaults();
    }

    function save() {
        try {
            localStorage.setItem(storageKey, JSON.stringify({ loan: readLoan(), changes }));
            $('storage-note').hidden = true;
            document.querySelector('.local-badge').textContent = 'Saved on this device';
        } catch (error) {
            storageNotice('Your browser could not save these changes. You can still calculate, but changes may be lost when you close the page.');
        }
    }

    function showError(error) {
        $('error').textContent = error.message;
        $('error').hidden = false;
    }

    function addCell(row, text, colSpan) {
        const cell = document.createElement('td');
        cell.textContent = text;
        if (colSpan) cell.colSpan = colSpan;
        row.append(cell);
        return cell;
    }

    function render(result) {
        const last = result.rows.at(-1);
        $('summary-emi').textContent = money(result.initialEmi);
        $('emi-detail').textContent = `Final payment: ${money(last.emi + last.prepayment)}`;
        $('summary-interest').textContent = money(result.totalInterest);
        $('summary-total').textContent = `${money(result.totalPaid)} total paid`;
        $('summary-payoff').textContent = formatDate(result.payoffDate);
        $('summary-term').textContent = `${result.rows.length} months${result.monthsSaved > 0 ? ` · ${result.monthsSaved} fewer` : result.monthsSaved < 0 ? ` · ${-result.monthsSaved} more` : ''}`;
        $('savings-label').textContent = result.interestSaved < 0 ? 'Extra interest' : 'Interest saved';
        $('summary-savings').textContent = money(Math.abs(result.interestSaved));
        $('comparison-label').textContent = changes.length ? `${changes.length} planned change${changes.length === 1 ? '' : 's'}` : 'Original loan';
        $('row-count').textContent = `${result.rows.length} installments`;
        const notes = ['Blue rows include a prepayment or a change; the current month has a green border. The final installment settles any rounding difference.'];
        if (result.ignoredChanges) notes.push(`${result.ignoredChanges} change(s) after payoff were not applied.`);
        const unused = result.rows.reduce((sum, row) => sum + row.unusedPrepayment, 0);
        if (unused) notes.push(`${money(unused)} of requested prepayments was not needed to close the loan.`);
        $('schedule-note').textContent = notes.join(' ');
        const fragment = document.createDocumentFragment();
        const currentMonth = localDate(new Date()).slice(0, 7);
        for (const payment of result.rows) {
            const row = document.createElement('tr');
            const isCurrentMonth = payment.date.slice(0, 7) === currentMonth;
            row.className = [payment.changed ? 'changed' : '', isCurrentMonth ? 'current-month' : ''].filter(Boolean).join(' ');
            [payment.number, formatDate(payment.date), money(payment.emi), payment.prepayment ? money(payment.prepayment) : '—', money(payment.interest), money(payment.principal), money(payment.balance)].forEach(value => addCell(row, value));
            if (isCurrentMonth) {
                row.setAttribute('aria-current', 'date');
                const label = document.createElement('span');
                label.className = 'current-month-label';
                label.textContent = 'Current month';
                row.children[1].append(label);
            }
            fragment.append(row);
        }
        $('schedule-body').replaceChildren(fragment);
        const total = document.createElement('tr');
        addCell(total, 'Total', 2).className = 'total-label';
        [result.totalPaid - result.totalPrepayment, result.totalPrepayment, result.totalInterest, result.totalPaid - result.totalInterest, 0].forEach(value => {
            addCell(total, money(value)).className = 'total-amount';
        });
        $('schedule-total').replaceChildren(total);
        $('results').hidden = false;
        $('error').hidden = true;
        $('status').textContent = `Schedule updated: ${result.rows.length} installments, paid off ${formatDate(result.payoffDate)}.`;
    }

    function refresh(persist = true) {
        try {
            render(LoanCalculator.calculate(readLoan(), changes));
            if (persist) save();
        } catch (error) {
            $('results').hidden = true;
            document.querySelector('.local-badge').textContent = 'Changes not saved';
            showError(error);
        }
    }

    function renderChanges() {
        const list = $('change-list');
        list.replaceChildren();
        if (!changes.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-list';
            empty.textContent = 'No changes added. Your original loan is shown below.';
            list.append(empty);
        }
        [...changes].sort((a, b) => a.date.localeCompare(b.date)).forEach(change => {
            const item = document.createElement('div'); item.className = 'change-item';
            const text = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = change.type === 'ROI_CHANGE' ? `Annual interest → ${Number(change.value)}%` : `${change.type === 'ONE_TIME' ? 'Prepayment' : 'Monthly EMI →'} ${money(Math.round(Number(change.value) * 100))}`;
            const detail = document.createElement('small');
            detail.textContent = formatDate(change.date) + (change.type === 'ONE_TIME' ? ` · ${change.effect === 'REDUCE_EMI' ? 'Reduce EMI' : 'Reduce tenure'}` : '');
            text.append(title, detail);
            const actions = document.createElement('div'); actions.className = 'change-actions';
            const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Edit';
            edit.setAttribute('aria-label', `Edit ${title.textContent} on ${formatDate(change.date)}`);
            edit.addEventListener('click', () => {
                editingId = change.id;
                $('change-type').value = change.type;
                $('change-date').value = change.date;
                $('change-value').value = change.value;
                document.querySelector(`input[name="effect"][value="${change.effect || 'REDUCE_TENURE'}"]`).checked = true;
                updateChangeType();
                $('save-change').textContent = 'Save change'; $('cancel-edit').hidden = false;
                $('change-value').focus();
            });
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button remove'; remove.textContent = 'Remove';
            remove.setAttribute('aria-label', `Remove ${title.textContent} on ${formatDate(change.date)}`);
            remove.addEventListener('click', () => {
                changes = changes.filter(item => item.id !== change.id);
                if (editingId === change.id) cancelEdit();
                renderChanges(); refresh();
            });
            actions.append(edit, remove); item.append(text, actions); list.append(item);
        });
    }

    function updateChangeType() {
        const type = $('change-type').value;
        $('effect-field').hidden = type !== 'ONE_TIME';
        $('change-value-label').textContent = type === 'ROI_CHANGE' ? 'New annual interest (%)' : type === 'EMI_CHANGE' ? 'New monthly EMI' : 'Prepayment amount';
        $('change-value').min = type === 'ROI_CHANGE' ? '0' : '0.01';
        $('change-value').max = type === 'ROI_CHANGE' ? '100' : '1000000000000';
        $('change-value').step = type === 'ROI_CHANGE' ? 'any' : '0.01';
    }

    function cancelEdit() {
        editingId = null; $('change-form').reset();
        $('change-date').value = $('startDate').value;
        $('save-change').textContent = '+ Add change'; $('cancel-edit').hidden = true;
        updateChangeType();
    }

    $('loan-form').addEventListener('submit', event => { event.preventDefault(); refresh(); });
    $('loan-form').addEventListener('change', () => refresh());
    $('number-format').addEventListener('change', () => {
        const locale = $('number-format').value === 'en-IN' ? 'en-IN' : 'en-US';
        moneyFormatter = formatter(locale);
        renderChanges();
        refresh(false);
        try {
            localStorage.setItem(numberFormatKey, locale);
        } catch (error) {
            storageNotice('The number format has changed, but your browser could not save this preference.');
        }
    });
    $('change-type').addEventListener('change', updateChangeType);
    $('cancel-edit').addEventListener('click', cancelEdit);
    $('change-form').addEventListener('submit', event => {
        event.preventDefault();
        if (!$('loan-form').reportValidity()) return;
        const change = { id: editingId || id(), date: $('change-date').value, type: $('change-type').value,
            value: Number($('change-value').value), effect: document.querySelector('input[name="effect"]:checked').value };
        const draft = editingId ? changes.map(item => item.id === editingId ? change : item) : [...changes, change];
        try {
            const result = LoanCalculator.calculate(readLoan(), draft);
            changes = draft; renderChanges(); render(result); save(); cancelEdit();
        } catch (error) { showError(error); }
    });
    $('reset').addEventListener('click', () => {
        if (!confirm('Reset this calculator’s saved loan and changes?')) return;
        changes = []; fillLoan(defaults()); cancelEdit(); renderChanges(); refresh();
    });
    loadNumberFormat(); fillLoan(load()); cancelEdit(); renderChanges(); refresh(false);
})();
