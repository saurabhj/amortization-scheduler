/* Monthly loan calculations. All balances and payments use integer minor units. */
(function (root) {
    'use strict';
    const MAX_MONTHS = 1200;
    const MAX_AMOUNT = 1e12;

    function amount(value, label, allowZero = false) {
        const number = Number(value);
        if (value === '' || !Number.isFinite(number) || number < 0 || number > MAX_AMOUNT || (!allowZero && number === 0)) {
            throw new Error(`${label} must be ${allowZero ? 'zero or ' : ''}a positive number no greater than 1 trillion.`);
        }
        const cents = Math.round((number + Number.EPSILON) * 100);
        if (!allowZero && cents === 0) throw new Error(`${label} must be at least 0.01.`);
        return cents;
    }

    function rate(value) {
        const number = Number(value);
        if (value === '' || !Number.isFinite(number) || number < 0 || number > 100) {
            throw new Error('Annual interest must be between 0 and 100%.');
        }
        return number;
    }

    function parseDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) throw new Error('Enter a valid date.');
        const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
        const date = new Date(year, month - 1, day);
        if (year < 1900 || year > 9999 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            throw new Error('Enter a valid date between 1900 and 9999.');
        }
        return { year, month, day, index: year * 12 + month - 1 };
    }

    function dateAt(start, offset) {
        const index = start.index + offset;
        const year = Math.floor(index / 12), month = index % 12;
        if (year > 9999) throw new Error('The payoff date is outside the supported date range.');
        const day = Math.min(start.day, new Date(year, month + 1, 0).getDate());
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    function installment(balance, months, annualRate) {
        if (!Number.isInteger(months) || months < 1) throw new Error('There are no installments remaining to reduce.');
        const monthlyRate = annualRate / 1200;
        // log1p/expm1 avoid cancellation for very small interest rates.
        const payment = monthlyRate === 0 ? balance / months : balance * monthlyRate / -Math.expm1(-months * Math.log1p(monthlyRate));
        return Math.max(1, Math.round(payment));
    }

    function interest(balance, annualRate) {
        return Math.round(balance * annualRate / 1200);
    }

    function remainingMonths(balance, emi, annualRate) {
        for (let count = 1; count <= MAX_MONTHS; count++) {
            const charge = interest(balance, annualRate);
            if (emi <= charge) throw new Error('The EMI does not cover monthly interest. Increase the EMI or reduce the balance.');
            balance -= Math.min(emi, balance + charge) - charge;
            if (balance === 0) return count;
        }
        throw new Error('This loan would take more than 1,200 months to repay. Increase the EMI.');
    }

    function normalizeLoan(input) {
        const months = Number(input.months);
        if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) throw new Error('Tenure must be a whole number from 1 to 1,200 months.');
        return { principal: amount(input.principal, 'Loan amount'), months, annualRate: rate(input.annualRate), start: parseDate(input.startDate) };
    }

    function normalizeChanges(changes, start) {
        return changes.map((change, order) => {
            const date = parseDate(change.date);
            if (date.index < start.index) throw new Error('A change cannot be before the first EMI month.');
            if (!['ONE_TIME', 'EMI_CHANGE', 'ROI_CHANGE'].includes(change.type)) throw new Error('Select a valid change type.');
            const effect = change.effect || 'REDUCE_TENURE';
            if (!['REDUCE_TENURE', 'REDUCE_EMI'].includes(effect)) throw new Error('Select a valid prepayment option.');
            return { ...change, effect, order, month: date.index - start.index, value: change.type === 'ROI_CHANGE' ? rate(change.value) : amount(change.value, 'Change amount') };
        }).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    }

    function schedule(loan, changes) {
        let balance = loan.principal, annualRate = loan.annualRate;
        let emi = installment(balance, loan.months, annualRate), payoffMonth = loan.months;
        const initialEmi = emi, rows = [], used = new Set();
        let totalInterest = 0, totalPaid = 0, totalPrepayment = 0;

        for (let month = 0; balance > 0 && month < MAX_MONTHS; month++) {
            const events = changes.filter(change => change.month === month);
            let termsChanged = false;
            for (const event of events) {
                used.add(event.order);
                if (event.type === 'ROI_CHANGE') { termsChanged ||= annualRate !== event.value; annualRate = event.value; }
                if (event.type === 'EMI_CHANGE') { termsChanged ||= emi !== event.value; emi = event.value; }
            }
            const openingBalance = balance;
            const charge = interest(balance, annualRate);
            const requestedPrepayment = events.filter(event => event.type === 'ONE_TIME').reduce((sum, event) => sum + event.value, 0);
            if (emi <= charge && emi + requestedPrepayment < balance + charge) {
                throw new Error('The EMI does not cover monthly interest. Increase the EMI or reduce the balance.');
            }
            // The final scheduled installment reconciles accumulated cent rounding.
            // A rate/manual EMI change establishes a new term instead of forcing payoff.
            const payment = Math.min(balance + charge, !termsChanged && month + 1 === payoffMonth ? balance + charge : emi);
            balance = balance + charge - payment;
            if (balance > requestedPrepayment && termsChanged) {
                payoffMonth = month + 1 + remainingMonths(balance, emi, annualRate);
            }
            let prepayment = 0;
            for (const event of events.filter(event => event.type === 'ONE_TIME')) {
                const applied = Math.min(event.value, balance);
                balance -= applied;
                prepayment += applied;
                if (balance > 0 && applied > 0) {
                    if (event.effect === 'REDUCE_EMI') {
                        emi = installment(balance, payoffMonth - month - 1, annualRate);
                    } else {
                        payoffMonth = Math.min(payoffMonth, month + 1 + remainingMonths(balance, emi, annualRate));
                    }
                }
            }
            totalInterest += charge;
            totalPaid += payment + prepayment;
            totalPrepayment += prepayment;
            if (![totalInterest, totalPaid, totalPrepayment].every(Number.isSafeInteger)) {
                throw new Error('These amounts exceed the calculator’s safe precision. Use smaller loan amounts.');
            }
            rows.push({ number: month + 1, date: dateAt(loan.start, month), openingBalance, emi: payment, prepayment, interest: charge,
                principal: openingBalance - balance, balance, annualRate, nextEmi: balance ? emi : 0, changed: events.length > 0,
                unusedPrepayment: requestedPrepayment - prepayment });
        }
        if (balance > 0) throw new Error('This loan would take more than 1,200 months to repay. Increase the EMI.');
        return { rows, initialEmi, totalInterest, totalPaid, totalPrepayment, payoffDate: rows.at(-1).date,
            ignoredChanges: changes.filter(change => !used.has(change.order)).length };
    }

    function calculate(input, changes = []) {
        const loan = normalizeLoan(input);
        const baseline = schedule(loan, []);
        const result = changes.length ? schedule(loan, normalizeChanges(changes, loan.start)) : baseline;
        return { ...result, originalInterest: baseline.totalInterest, interestSaved: baseline.totalInterest - result.totalInterest,
            monthsSaved: baseline.rows.length - result.rows.length };
    }

    const api = { calculate, parseDate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LoanCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
