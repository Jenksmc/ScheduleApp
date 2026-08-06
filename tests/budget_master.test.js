const assert = require("node:assert/strict");
const BudgetMaster = require("../scheduleapp/budget_master.js");

function profile(owner) {
  return {
    _ts: owner === "britt" ? 10 : 20,
    recurring: {
      incomeSources: [{ id: 1, name: owner + " income", hourlyRate: 10, defaultHours: 40 }],
      savingsTransfers: [], autoTransfers: [],
      bills: [
        { id: 2, name: "Rent", amount: 500, isDebt: false },
        { id: 3, name: owner + " card", amount: 50, isDebt: true }
      ],
      subscriptions: [], variable: [{ id: 4, name: "Groceries", weeklyBudget: 50 }],
      savings_household: [], savings_personal: []
    },
    incomeWeeks: [{ id: 5, sourceId: 1, payDate: "2026-08-01", hours: 40, rate: 10, status: "received" }],
    expenses: [{ id: 6, recurringId: 4, type: "variable", category: "Groceries", amount: 25, date: "2026-08-02" }],
    periods: { ["week:" + owner]: { startBalance: 1 } },
    settings: { varWeeklyDefault: 50 }
  };
}

const britt = profile("britt");
const christian = profile("christian");
const oldJoint = {
  _ts: 30,
  recurring: {
    incomeSources: [{ id: "britt-1", name: "derived", sourceProfile: "britt" }],
    savingsTransfers: [], autoTransfers: [],
    bills: [{ id: 88, name: "Joint-created bill", amount: 70 }],
    subscriptions: [], variable: [], savings_household: [], savings_personal: []
  },
  incomeWeeks: [],
  expenses: [{ id: 89, type: "variable", amount: 5, date: "2026-08-02", owner: "joint" }],
  periods: {}, settings: {}
};

const master = BudgetMaster.migrate({ britt, christian, joint: oldJoint, now: 1000 });
assert.equal(master.schemaVersion, 5);
assert.equal(master.recurring.incomeSources.length, 2, "derived joint income is not copied twice");
assert.equal(master.recurring.bills.length, 5, "all personal bills plus direct joint bill survive");
assert.equal(master.expenses.length, 3, "all personal expenses plus direct joint expense survive");
assert.equal(master.duplicateCandidates.some(item => item.name === "rent"), true, "possible duplicates are flagged, not merged");
assert.equal(master.recurring.bills.find(item => item.name === "britt card").scope, "personal");
assert.equal(master.expenses.find(item => item.legacyRef?.profile === "britt").owner, "britt");
assert.deepEqual(BudgetMaster.migrate({ joint: master, now: 2000 }), master, "v5 migration is idempotent");

const jointView = BudgetMaster.makeView(master, "joint");
assert.equal(jointView.recurring.bills.some(item => item.isDebt), false, "personal debt is hidden from joint");
assert.equal(jointView.recurring.incomeSources.length, 2, "joint sees both incomes");
const brittView = BudgetMaster.makeView(master, "britt");
assert.equal(brittView.recurring.bills.some(item => item.name === "britt card"), true);
assert.equal(brittView.recurring.bills.some(item => item.name === "christian card"), false);

const christianBillCount = master.recurring.bills.filter(item => item.owner === "christian").length;
brittView.recurring.bills = brittView.recurring.bills.filter(item => item.name !== "britt card");
const merged = BudgetMaster.mergeView(master, brittView, "britt", 3000);
assert.equal(merged.recurring.bills.filter(item => item.owner === "christian").length, christianBillCount, "saving Brittni cannot delete Christian records");
assert.equal(merged.recurring.bills.some(item => item.name === "britt card"), false, "Brittni can edit her filtered records");

merged.expenses.push(
  { id: 200001, owner: "britt", scope: "personal", type: "savings", savingsBucket: "personal_pool", amount: 100, date: "2026-08-03" },
  { id: 200002, owner: "britt", scope: "personal", type: "variable", amount: 20, date: "2026-08-03" },
  { id: 200003, owner: "britt", scope: "personal", type: "savings", savingsBucket: "personal", amount: 30, date: "2026-08-03" }
);
assert.deepEqual(BudgetMaster.poolSummary(merged, "britt", "2026-08-01", "2026-08-31"), { funding: 100, spending: 20, savings: 30, balance: 50 });
const income = BudgetMaster.incomeByOwner(master, "2026-08-01", "2026-08-31");
assert.equal(income.britt.actual, 400);
assert.equal(income.christian.actual, 400);

const autoOnly = profile("britt");
autoOnly.recurring.savingsTransfers = [];
autoOnly.recurring.autoTransfers = [{ id: 7, name: "Legacy auto save", amount: 10, bucket: "household" }];
const autoMaster = BudgetMaster.migrate({ britt: autoOnly, now: 4000 });
assert.equal(autoMaster.recurring.savingsTransfers.filter(item => item.name === "Legacy auto save").length, 1, "legacy auto-transfers migrate exactly once");

console.log("budget_master tests passed");
