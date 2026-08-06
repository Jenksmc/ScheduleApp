/* Shared budget master, schema v5.
 * budgetData_joint is authoritative. Legacy personal keys are retained as
 * rollback sources and are never deleted by this code.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BudgetMaster = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = 5;
  const PEOPLE = ["britt", "christian"];
  const RECURRING_KEYS = ["incomeSources", "savingsTransfers", "autoTransfers", "bills", "subscriptions", "variable", "savings_household", "savings_personal"];
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const arr = value => Array.isArray(value) ? value : [];
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  function emptyMaster(now) {
    return {
      schemaVersion: VERSION, _ts: now, masterNid: 100000,
      recurring: Object.fromEntries(RECURRING_KEYS.map(key => [key, []])),
      incomeWeeks: [], expenses: [], periods: {}, settings: {},
      profilePeriods: { britt: {}, christian: {} },
      profileSettings: { britt: {}, christian: {} },
      duplicateCandidates: [],
      migration: { version: VERSION, migratedAt: now, legacyKeysRetained: true }
    };
  }

  function maxId(data) {
    let max = 99999;
    const scan = items => arr(items).forEach(item => {
      const id = Number(item && item.id);
      if (Number.isInteger(id)) max = Math.max(max, id);
    });
    if (data) {
      Object.values(data.recurring || {}).forEach(scan);
      scan(data.incomeWeeks); scan(data.expenses);
    }
    return max;
  }

  function normalize(master, now) {
    const out = clone(master) || emptyMaster(now || Date.now());
    out.schemaVersion = VERSION;
    out.recurring ||= {};
    RECURRING_KEYS.forEach(key => { out.recurring[key] = arr(out.recurring[key]); });
    out.incomeWeeks = arr(out.incomeWeeks); out.expenses = arr(out.expenses);
    out.periods ||= {}; out.settings ||= {};
    out.profilePeriods ||= { britt: {}, christian: {} };
    out.profileSettings ||= { britt: {}, christian: {} };
    PEOPLE.forEach(person => {
      out.profilePeriods[person] ||= {};
      out.profileSettings[person] ||= {};
    });
    out.duplicateCandidates = arr(out.duplicateCandidates);
    out.migration ||= { version: VERSION, migratedAt: now || Date.now(), legacyKeysRetained: true };
    out.migration.legacyKeysRetained = true;
    out.masterNid = Math.max(num(out.masterNid), maxId(out) + 1, 100000);
    return out;
  }

  function derivedJoint(item) {
    if (!item) return false;
    if (item.sourceProfile || item.sourceProfiles || item.sourceExpenseId != null) return true;
    return /^(britt|christian)-(week|exp|sav|hh|\d)|^joint-(bill|sub|var)-(britt|christian)-/.test(String(item.id || ""));
  }
  function owner(item, fallback) {
    const value = item && (item.owner || item.spender || item.sourceProfile || item.targetOwner);
    if (PEOPLE.includes(value)) return value;
    return PEOPLE.includes(fallback) ? fallback : "household";
  }
  function scope(type, item) {
    if (item && ["household", "personal"].includes(item.scope)) return item.scope;
    if (type === "bills" && item && item.isDebt) return "personal";
    if (type === "savings_personal") return "personal";
    if (type === "expenses" && item && item.type === "savings" && ["personal", "personal_pool"].includes(item.savingsBucket)) return "personal";
    return "household";
  }
  function record(type, item, fallback, id) {
    const out = { ...clone(item), id, owner: owner(item, fallback) };
    if (!['incomeSources', 'incomeWeeks'].includes(type)) out.scope = scope(type, item);
    return out;
  }

  function migrate(input) {
    const now = num(input && input.now) || Date.now();
    const current = input && input.joint;
    if (current && num(current.schemaVersion) >= VERSION) return normalize(current, now);
    const sources = { britt: input && input.britt, christian: input && input.christian, joint: current };
    let next = Math.max(99999, ...Object.values(sources).filter(Boolean).map(maxId)) + 1;
    const master = emptyMaster(now);
    const maps = { britt: {}, christian: {}, joint: {} };
    const nextId = () => next++;

    Object.entries(sources).forEach(([profile, source]) => {
      if (!source || !source.recurring) return;
      RECURRING_KEYS.forEach(type => {
        const items = arr(source.recurring[type]);
        items.forEach(item => {
          if (profile === "joint" && derivedJoint(item)) return;
          const id = nextId();
          maps[profile][type + ":" + item.id] = id;
          const copied = record(type, item, profile === "joint" ? null : profile, id);
          copied.legacyRef = { profile, id: item.id };
          if (type === "autoTransfers") {
            copied.legacyType = "autoTransfers";
            master.recurring.savingsTransfers.push(copied);
          } else master.recurring[type].push(copied);
        });
      });
    });

    Object.entries(sources).forEach(([profile, source]) => {
      arr(source && source.incomeWeeks).forEach(item => {
        if (profile === "joint" && derivedJoint(item)) return;
        const copied = record("incomeWeeks", item, profile === "joint" ? null : profile, nextId());
        const mapped = maps[profile]["incomeSources:" + item.sourceId];
        if (mapped != null) copied.sourceId = mapped;
        copied.legacyRef = { profile, id: item.id };
        master.incomeWeeks.push(copied);
      });
      arr(source && source.expenses).forEach(item => {
        if (profile === "joint" && derivedJoint(item)) return;
        const copied = record("expenses", item, profile === "joint" ? null : profile, nextId());
        const type = item.type === "bill" ? "bills" : item.type === "subscription" ? "subscriptions" : item.type === "variable" ? "variable" : null;
        const mapped = type && maps[profile][type + ":" + item.recurringId];
        if (mapped != null) {
          copied.recurringId = mapped;
          if (copied.recKey) copied.recKey = mapped + ":" + copied.date;
        }
        copied.legacyRef = { profile, id: item.id };
        master.expenses.push(copied);
      });
    });

    master.periods = clone((current && current.periods) || {});
    master.settings = clone((current && current.settings) || {});
    PEOPLE.forEach(person => {
      master.profilePeriods[person] = clone((sources[person] && sources[person].periods) || {});
      master.profileSettings[person] = clone((sources[person] && sources[person].settings) || {});
    });
    master.masterNid = next;
    master._ts = Math.max(now, ...Object.values(sources).map(data => num(data && data._ts)));
    master.migration.sourceTimestamps = Object.fromEntries(Object.entries(sources).map(([key, data]) => [key, num(data && data._ts)]));

    ["bills", "subscriptions", "variable"].forEach(type => {
      const groups = {};
      master.recurring[type].forEach(item => {
        const key = String(item.name || "").trim().toLowerCase();
        if (key) (groups[key] ||= []).push(item);
      });
      Object.entries(groups).forEach(([name, items]) => {
        if (items.length > 1 && new Set(items.map(item => item.owner)).size > 1) {
          master.duplicateCandidates.push({ type, name, ids: items.map(item => item.id), preserved: true });
        }
      });
    });
    return normalize(master, now);
  }

  function visible(type, item, profile) {
    if (profile === "joint") {
      if (["incomeSources", "incomeWeeks", "savingsTransfers"].includes(type)) return true;
      if (type === "expenses" && item.type === "savings" && ["personal", "personal_pool"].includes(item.savingsBucket)) return true;
      return (item.scope || "household") === "household";
    }
    if (type === "variable" && item.owner === "household" && (item.scope || "household") === "household") return true;
    return item.owner === profile;
  }
  function makeView(master, profile) {
    const source = normalize(master, Date.now());
    const view = clone(source);
    RECURRING_KEYS.forEach(type => { view.recurring[type] = source.recurring[type].filter(item => visible(type, item, profile)); });
    view.incomeWeeks = source.incomeWeeks.filter(item => visible("incomeWeeks", item, profile));
    view.expenses = source.expenses.filter(item => visible("expenses", item, profile));
    view.periods = clone(profile === "joint" ? source.periods : source.profilePeriods[profile]);
    view.settings = clone(profile === "joint" ? source.settings : source.profileSettings[profile]);
    view.viewProfile = profile;
    return view;
  }
  function mergeView(master, view, profile, now) {
    const out = normalize(master, now || Date.now());
    const replace = (oldItems, newItems, type) => oldItems.filter(item => !visible(type, item, profile)).concat(clone(arr(newItems)));
    RECURRING_KEYS.forEach(type => { out.recurring[type] = replace(out.recurring[type], view.recurring && view.recurring[type], type); });
    out.incomeWeeks = replace(out.incomeWeeks, view.incomeWeeks, "incomeWeeks");
    out.expenses = replace(out.expenses, view.expenses, "expenses");
    if (profile === "joint") { out.periods = clone(view.periods || {}); out.settings = clone(view.settings || {}); }
    else { out.profilePeriods[profile] = clone(view.periods || {}); out.profileSettings[profile] = clone(view.settings || {}); }
    out.masterNid = Math.max(num(view.masterNid), num(out.masterNid), maxId(out) + 1);
    out._ts = now || Date.now();
    return out;
  }
  function incomeByOwner(data, start, end) {
    const result = { britt: { budget: 0, actual: 0 }, christian: { budget: 0, actual: 0 }, household: { budget: 0, actual: 0 } };
    arr(data && data.incomeWeeks).forEach(item => {
      if (!item.payDate || item.payDate < start || item.payDate > end) return;
      const who = PEOPLE.includes(item.owner) ? item.owner : "household";
      const amount = (item.incomeType || "hourly") === "lump-sum" ? num(item.amount) : num(item.hours) * num(item.rate);
      result[who].budget += amount;
      if (item.status === "received") result[who].actual += amount;
    });
    return result;
  }
  function poolSummary(data, who, start, end) {
    const mine = arr(data && data.expenses).filter(item => item.owner === who && (!start || item.date >= start) && (!end || item.date <= end));
    const sum = predicate => mine.filter(predicate).reduce((total, item) => total + num(item.amount), 0);
    const funding = sum(item => item.type === "savings" && item.savingsBucket === "personal_pool");
    const savings = sum(item => item.type === "savings" && item.savingsBucket === "personal");
    const spending = sum(item => item.type === "variable" && item.scope === "personal");
    return { funding, savings, spending, balance: funding - savings - spending };
  }
  return { VERSION, PEOPLE, RECURRING_KEYS, clone, migrate, normalize, makeView, mergeView, incomeByOwner, poolSummary, visible };
});

/* Installed after dashboard.html defines its v4 functions and before boot. */
if (typeof window !== "undefined") {
  let jointMaster = null;
  let jointNid = 100000;
  const legacyPull = pullFromServer;
  const legacyWeekly = renderWeeklyView;
  const legacyMonthly = renderMonthlyView;
  const legacyOverview = renderBudgetOverview;
  const legacyPopulateIncome = populateMIS;
  const legacySaveIncome = saveIncomeSource;
  const legacyOpenAddExpense = openAddExpenseSheet;
  const legacyOpenEditExpense = openEditExpense;
  const legacyOpenRecurring = _openRecExpenseModal;
  const legacySaveRecurring = saveRecExpense;
  const legacyOpenAddSavings = openAddSavingsTransfer;
  const legacyOpenEditSavings = openEditSavingsTransfer;
  const legacyGenerateIncome = generateIncomeWeeks;

  function newest(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return (remote._ts || 0) >= (local._ts || 0) ? remote : local;
  }
  function readLocalMaster() {
    try { return JSON.parse(localStorage.getItem("budgetData_joint_v5") || "null"); }
    catch (_) { return null; }
  }
  function masterFrom(payload) {
    const candidate = newest(readLocalMaster(), payload && payload.budgetData_joint);
    const migrated = !candidate || Number(candidate.schemaVersion || 0) < BudgetMaster.VERSION;
    const hasSpecificPersonal = !!(payload && (payload.budgetData_britt || payload.budgetData_christian));
    return {
      migrated,
      master: BudgetMaster.migrate({
        joint: candidate || (payload && payload.budgetData_joint),
        // Very old installs only had budgetData. Treat that as Brittni's
        // legacy store; never import it again as a direct Joint copy.
        britt: payload && (payload.budgetData_britt || (!hasSpecificPersonal ? payload.budgetData : null)),
        christian: payload && payload.budgetData_christian,
        now: Date.now()
      })
    };
  }
  function adopt(master, profile) {
    jointMaster = BudgetMaster.normalize(master, Date.now());
    jointNid = jointMaster.masterNid;
    localStorage.setItem("budgetData_joint_v5", JSON.stringify(jointMaster));
    localStorage.setItem("budgetNid_joint_v5", String(jointNid));
    budgetData = profile ? BudgetMaster.makeView(jointMaster, profile) : jointMaster;
    budgetNid = jointNid;
  }
  async function getPayload() {
    const response = await fetch(API_BASE + "/api/data");
    if (!response.ok) throw new Error("Budget data request failed");
    const payload = await response.json();
    if (payload.updated) _serverUpdated = payload.updated;
    return payload;
  }

  loadProfileBudgetData = async function () {
    if (!activeBudgetProfile) return;
    const result = masterFrom(await getPayload());
    adopt(result.master, activeBudgetProfile);
    ensureBudgetSettings();
    if (result.migrated) await pushToServer();
  };
  loadJointBudgetData = loadProfileBudgetData;

  saveProfileBudgetData = function () {
    if (!jointMaster || !activeBudgetProfile || !budgetData) return;
    jointMaster = BudgetMaster.mergeView(jointMaster, budgetData, activeBudgetProfile, Date.now());
    jointNid = jointMaster.masterNid;
    localStorage.setItem("budgetData_joint_v5", JSON.stringify(jointMaster));
    localStorage.setItem("budgetNid_joint_v5", String(jointNid));
    localStorage.setItem("budgetView_v5_" + activeBudgetProfile, JSON.stringify(budgetData));
  };
  saveBudgetData = function () {
    bvCacheClear();
    if (!budgetData || !activeBudgetProfile) return;
    budgetData._ts = Date.now();
    budgetData.masterNid = Math.max(Number(budgetNid) || 0, Number(budgetData.masterNid) || 0);
    saveProfileBudgetData();
    if (typeof _bootComplete !== "undefined" && _bootComplete) pushToServer();
  };

  pushToServer = async function () {
    try {
      if (jointMaster && activeBudgetProfile && budgetData) saveProfileBudgetData();
      const master = jointMaster || BudgetMaster.normalize(budgetData, Date.now());
      const payload = {
        baseUpdated: _serverUpdated, tasks, shoppingList, shoppingLists, shopListNid,
        customHolidays, workSchedules, members, healthData, budgetPins, nid, shopNid, wsNid,
        budgetData: master, budgetNid: master.masterNid,
        budgetData_joint: master, budgetNid_joint: master.masterNid
      };
      const response = await fetch(API_BASE + "/api/data", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (response.status === 409) {
        console.warn("Shared budget push was stale; loading the newer master");
        await pullFromServer();
        if (typeof renderHome === "function") renderHome();
        return;
      }
      const body = await response.json().catch(() => null);
      if (body && body.updated) _serverUpdated = body.updated;
    } catch (error) { console.warn("Shared budget push failed:", error); }
  };

  pullFromServer = async function () {
    const profile = activeBudgetProfile;
    activeBudgetProfile = null;
    try { await legacyPull(); }
    finally { activeBudgetProfile = profile; }
    try {
      const result = masterFrom(await getPayload());
      adopt(result.master, profile);
      if (result.migrated) await pushToServer();
    } catch (error) { console.warn("Shared budget pull failed:", error); }
  };

  const defaultOwner = () => activeBudgetProfile === "christian" ? "christian" : "britt";
  const defaultScope = () => activeBudgetProfile === "joint" ? "household" : "personal";
  function chosen(id, fallback) {
    const value = document.getElementById(id)?.value;
    return BudgetMaster.PEOPLE.includes(value) ? value : fallback;
  }

  generateIncomeWeeks = function () {
    legacyGenerateIncome();
    const sources = budgetData?.recurring?.incomeSources || [];
    (budgetData?.incomeWeeks || []).forEach(week => {
      if (BudgetMaster.PEOPLE.includes(week.owner)) return;
      const source = sources.find(item => String(item.id) === String(week.sourceId));
      week.owner = BudgetMaster.PEOPLE.includes(source?.owner) ? source.owner : defaultOwner();
    });
  };

  openTrackerAdd = function () {
    if (trackerView === "income") {
      document.getElementById("oti-name").value = "";
      document.getElementById("oti-amount").value = "";
      document.getElementById("oti-date").value = fd(new Date());
      document.getElementById("oti-owner").value = defaultOwner();
      document.getElementById("oti-owner").closest(".field").style.display = activeBudgetProfile === "joint" ? "block" : "none";
      document.getElementById("modal-one-time-income").style.display = "block";
      setTimeout(() => document.getElementById("oti-name").focus(), 50);
      return;
    }
    openAddExpenseSheet();
  };
  saveOneTimeIncome = function () {
    const name = document.getElementById("oti-name").value.trim();
    const amount = parseFloat(document.getElementById("oti-amount").value);
    const payDate = document.getElementById("oti-date").value;
    if (!name) { alert("Name required"); return; }
    if (!(amount > 0)) { alert("Amount must be greater than zero"); return; }
    if (!payDate) { alert("Payment date required"); return; }
    const who = activeBudgetProfile === "joint" ? chosen("oti-owner", defaultOwner()) : activeBudgetProfile;
    budgetData.incomeWeeks ||= [];
    budgetData.incomeWeeks.push({
      id: budgetNid++, weekStartDate: payDate, payDate,
      status: payDate <= fd(new Date()) ? "received" : "scheduled",
      sourceId: null, sourceName: name, sourceProfile: who, owner: who,
      incomeType: "lump-sum", amount, isOneTime: true
    });
    saveBudgetData(); closeModal("modal-one-time-income"); renderTrackerIncome();
  };
  openAddVarCategory = function () {
    const name = prompt("Category name (e.g. Groceries):");
    if (!name || !name.trim()) return;
    budgetData.recurring.variable ||= [];
    budgetData.recurring.variable.push({
      id: budgetNid++, name: name.trim(), weeklyBudget: 0,
      owner: activeBudgetProfile === "joint" ? "household" : activeBudgetProfile,
      scope: defaultScope()
    });
    saveBudgetData(); renderBudgetSettings();
  };

  populateMIS = function (source) {
    legacyPopulateIncome(source);
    const field = document.getElementById("mis-owner");
    if (field) {
      field.value = BudgetMaster.PEOPLE.includes(source.owner) ? source.owner : defaultOwner();
      field.closest(".field").style.display = activeBudgetProfile === "joint" ? "block" : "none";
    }
  };
  saveIncomeSource = function () {
    const name = document.getElementById("mis-name").value.trim(); if (!name) return;
    const incomeType = document.getElementById("mis-income-type")?.value || "hourly";
    const payFrequency = document.getElementById("mis-payfreq")?.value || "biweekly";
    const who = activeBudgetProfile === "joint" ? chosen("mis-owner", defaultOwner()) : activeBudgetProfile;
    const data = {
      name, incomeType,
      hourlyRate: parseFloat(document.getElementById("mis-rate").value) || 49.80,
      defaultHours: parseFloat(document.getElementById("mis-hours").value) || 40,
      amount: incomeType === "lump-sum" ? (parseFloat(document.getElementById("mis-amount").value) || 0) : null,
      payFrequency,
      payWeekday: parseInt(document.querySelector("#b-mis-weekday .badge.active")?.dataset.v ?? "4"),
      payMonthday: parseInt(document.getElementById("mis-monthday")?.value || "15"),
      payCustomDates: (document.getElementById("mis-customdates")?.value || "").split(",").map(value => parseInt(value.trim())).filter(value => !isNaN(value)),
      processingWeeks: 2,
      startDate: document.getElementById("mis-start").value || fd(new Date()),
      endDate: document.getElementById("mis-end").value || null,
      owner: who
    };
    if (_editMIS) {
      const item = budgetData.recurring.incomeSources.find(source => source.id === _editMIS);
      if (item) Object.assign(item, data);
    } else budgetData.recurring.incomeSources.push({ id: budgetNid++, ...data });
    generateIncomeWeeks();
    (budgetData.incomeWeeks || []).filter(week => week.sourceId === _editMIS).forEach(week => { week.owner = who; });
    saveBudgetData(); closeModal("modal-income-source"); renderBudgetSettings();
  };

  pickExpType = (function (original) {
    return function (type, button) {
      original(type, button);
      const field = document.getElementById("exp-owner-field");
      if (field) field.style.display = activeBudgetProfile === "joint" ? "block" : "none";
    };
  })(pickExpType);
  openAddExpenseSheet = function () {
    legacyOpenAddExpense();
    if (document.getElementById("exp-owner")) document.getElementById("exp-owner").value = defaultOwner();
    if (document.getElementById("exp-scope")) document.getElementById("exp-scope").value = defaultScope();
  };
  openEditExpense = function (id) {
    legacyOpenEditExpense(id);
    const item = (budgetData.expenses || []).find(entry => entry.id === id);
    if (!item) return;
    if (document.getElementById("exp-owner")) document.getElementById("exp-owner").value = BudgetMaster.PEOPLE.includes(item.owner) ? item.owner : defaultOwner();
    if (document.getElementById("exp-scope")) document.getElementById("exp-scope").value = item.scope || "household";
  };
  saveExpenseFromModal = function () {
    const amount = parseFloat(document.getElementById("exp-amount").value);
    if (!amount || amount <= 0) { alert("Enter an amount"); return; }
    const title = document.getElementById("exp-title").value.trim();
    const type = document.querySelector("#exp-type-badges .badge.active")?.dataset.v || "variable";
    const category = document.getElementById("exp-category")?.value || "";
    const savingsBucket = type === "savings" ? (document.querySelector("#exp-sav-field .badge.active")?.dataset.v || "household") : null;
    const nw = type === "variable" ? (document.querySelector("#exp-nw-field .badge.active")?.dataset.nw || "need") : null;
    const date = document.getElementById("exp-date").value || fd(new Date());
    const note = document.getElementById("exp-note").value.trim();
    const amazonLinks = [...document.querySelectorAll("#exp-amazon-links input[type=url]")].map(input => input.value.trim()).filter(Boolean);
    const subcategory = category === "Amazon" ? (document.getElementById("exp-subcategory")?.value || "") : "";
    const who = activeBudgetProfile === "joint" ? chosen("exp-owner", defaultOwner()) : activeBudgetProfile;
    const spendingScope = document.getElementById("exp-scope")?.value || defaultScope();
    const data = { title, type, category, subcategory, effectiveCategory: subcategory || category, savingsBucket, nw, amount, date, note, amazonLinks, owner: who, scope: spendingScope };
    budgetData.expenses ||= [];
    if (_editExpenseId) {
      const item = budgetData.expenses.find(entry => entry.id === _editExpenseId);
      if (item) Object.assign(item, data);
    } else budgetData.expenses.push({ id: budgetNid++, ...data });
    saveBudgetData(); closeModal("modal-add-expense"); renderTrackerView();
  };

  _openRecExpenseModal = function (title, editing, item) {
    legacyOpenRecurring(title, editing, item);
    if (document.getElementById("re-owner")) {
      document.getElementById("re-owner").value = BudgetMaster.PEOPLE.includes(item && item.owner) ? item.owner : defaultOwner();
      document.getElementById("re-owner").closest(".field").style.display = activeBudgetProfile === "joint" ? "block" : "none";
    }
    if (document.getElementById("re-scope")) document.getElementById("re-scope").value = (item && item.scope) || defaultScope();
  };
  saveRecExpense = function () {
    const name = document.getElementById("re-name").value.trim(); if (!name) { alert("Name required"); return; }
    const frequency = document.getElementById("re-frequency").value;
    const startDate = document.getElementById("re-startdate").value;
    let dueDay = 1, dueWeekday = 4;
    if (["weekly", "biweekly"].includes(frequency)) {
      dueWeekday = parseInt(document.querySelector("#b-re-weekday .badge.active")?.dataset.v ?? "4");
      dueDay = dueWeekday;
    } else dueDay = parseInt(document.getElementById("re-monthday")?.value || "1");
    const selectedNw = document.querySelector("#re-nw-badges .badge.active")?.dataset.renw || "unset";
    const data = {
      name, amount: parseFloat(document.getElementById("re-amount").value) || 0,
      frequency, startDate, endDate: document.getElementById("re-enddate")?.value || null,
      dueDay, dueWeekday, nw: selectedNw === "unset" ? null : selectedNw,
      isDebt: _reType === "bills" && document.getElementById("re-bill-type").value === "debt",
      owner: activeBudgetProfile === "joint" ? chosen("re-owner", defaultOwner()) : activeBudgetProfile,
      scope: document.getElementById("re-scope")?.value || defaultScope()
    };
    const items = budgetData.recurring[_reType] || (budgetData.recurring[_reType] = []);
    if (_reEditId) {
      const item = items.find(entry => entry.id === _reEditId);
      if (item) Object.assign(item, data);
    } else items.push({ id: budgetNid++, ...data });
    saveBudgetData(); closeModal("modal-rec-expense"); renderBudgetSettings();
  };

  openAddSavingsTransfer = function () {
    legacyOpenAddSavings();
    if (document.getElementById("st-owner")) {
      document.getElementById("st-owner").value = defaultOwner();
      document.getElementById("st-owner").closest(".field").style.display = activeBudgetProfile === "joint" ? "block" : "none";
    }
  };
  openEditSavingsTransfer = function (id) {
    legacyOpenEditSavings(id);
    const item = (budgetData.recurring.savingsTransfers || []).find(entry => entry.id === id);
    if (document.getElementById("st-owner")) {
      document.getElementById("st-owner").value = BudgetMaster.PEOPLE.includes(item && item.owner) ? item.owner : defaultOwner();
      document.getElementById("st-owner").closest(".field").style.display = activeBudgetProfile === "joint" ? "block" : "none";
    }
  };
  saveSavingsTransfer = function () {
    const name = document.getElementById("st-name").value.trim(); if (!name) return;
    const amount = parseFloat(document.getElementById("st-amount").value) || 0;
    const scheduleType = document.getElementById("st-schedule-type").value;
    const frequency = scheduleType === "paycheck" ? "per-paycheck" : document.getElementById("st-freq").value;
    const sourceValue = document.getElementById("st-income-source").value;
    const incomeSourceId = sourceValue === "" ? null : ((budgetData.recurring.incomeSources || []).find(item => String(item.id) === sourceValue)?.id ?? sourceValue);
    const bucket = document.getElementById("st-bucket").value;
    const who = activeBudgetProfile === "joint" ? chosen("st-owner", defaultOwner()) : activeBudgetProfile;
    const data = {
      name, amount, scheduleType, frequency, incomeSourceId,
      startDate: document.getElementById("st-startdate").value || fd(new Date()),
      endDate: document.getElementById("st-enddate").value || null,
      bucket, owner: who, scope: bucket === "household" ? "household" : "personal"
    };
    budgetData.recurring.savingsTransfers ||= [];
    if (_editSavTransferId) {
      const item = budgetData.recurring.savingsTransfers.find(entry => entry.id === _editSavTransferId);
      if (item) Object.assign(item, data);
    } else budgetData.recurring.savingsTransfers.push({ id: budgetNid++, ...data });
    saveBudgetData(); closeModal("modal-savings-transfer"); renderBudgetSettings();
  };

  function range(monthly) {
    if (monthly) {
      const [year, month] = budgetCurrentMonth.split("-").map(Number);
      return [fd(new Date(year, month - 1, 1)), fd(new Date(year, month, 0))];
    }
    const start = budgetCurrentWeekStart;
    return [start, fd(new Date(new Date(start + "T12:00:00").getTime() + 6 * 86400000))];
  }
  function renderOwnerIncome(monthly) {
    if (!jointMaster) return;
    const [start, end] = range(monthly);
    const values = BudgetMaster.incomeByOwner(jointMaster, start, end);
    const budgetPrefix = monthly ? "ms" : "ws";
    const actualPrefix = monthly ? "ma" : "wa";
    BudgetMaster.PEOPLE.forEach(person => {
      const show = activeBudgetProfile === "joint" || activeBudgetProfile === person;
      t(budgetPrefix + "-income-" + person, show ? $f(values[person].budget) : "—");
      t(actualPrefix + "-income-" + person, show ? $f(values[person].actual) : "—");
    });
    if (activeBudgetProfile !== "joint") {
      t(budgetPrefix + "-income", "—");
      t(actualPrefix + "-income", "—");
    }
    const transferred = BudgetMaster.PEOPLE.reduce((total, person) => total + BudgetMaster.poolSummary(jointMaster, person, start, end).savings, 0);
    const planned = activeBudgetProfile === "joint" ? (scheduledSavingsBuckets(start, end).pers || 0) : 0;
    t(budgetPrefix + "-personal-savings", activeBudgetProfile === "joint" ? $f(planned) : "—");
    t(actualPrefix + "-personal-savings", activeBudgetProfile === "joint" ? $f(transferred) : "—");
    document.querySelectorAll(".joint-only-summary").forEach(element => { element.style.display = activeBudgetProfile === "joint" ? "" : "none"; });
  }
  renderWeeklyView = function () { legacyWeekly(); renderOwnerIncome(false); };
  renderMonthlyView = function () { legacyMonthly(); renderOwnerIncome(true); };

  function poolCard(person, start, end) {
    const values = BudgetMaster.poolSummary(jointMaster, person, start, end);
    const name = person === "britt" ? "Brittni" : "Christian";
    return `<div class="budget-card" style="padding:12px">
      <div class="bcompact-title">${name.toUpperCase()} PERSONAL POOL</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px;text-align:center">
        <div><div style="font-size:10px;color:var(--muted)">FUNDED</div><div style="font-family:'DM Mono',monospace;font-weight:700">${$f(values.funding)}</div></div>
        <div><div style="font-size:10px;color:var(--muted)">SPENT</div><div style="font-family:'DM Mono',monospace;font-weight:700">${$f(values.spending)}</div></div>
        <div><div style="font-size:10px;color:var(--muted)">SAVED</div><div style="font-family:'DM Mono',monospace;font-weight:700">${$f(values.savings)}</div></div>
        <div><div style="font-size:10px;color:var(--muted)">AVAILABLE</div><div style="font-family:'DM Mono',monospace;font-weight:700;color:${values.balance < 0 ? "#e05555" : "#3db87a"}">${$f(values.balance)}</div></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn" onclick="openPersonalPoolEntry('fund','${person}')"><i class="ti ti-plus"></i> Add funds</button>
        <button class="btn" onclick="openPersonalPoolEntry('spend','${person}')">Personal spending</button>
        <button class="btn" onclick="openPersonalPoolEntry('save','${person}')">Move to savings</button>
      </div>
    </div>`;
  }
  function renderPersonalPools() {
    const host = document.getElementById("btab-overview-content");
    if (!host || !jointMaster || !activeBudgetProfile) return;
    let panel = document.getElementById("personal-pool-panel");
    if (!panel) {
      panel = document.createElement("div"); panel.id = "personal-pool-panel";
      const nav = host.querySelector(".budget-period-nav");
      if (nav) nav.insertAdjacentElement("afterend", panel); else host.prepend(panel);
    }
    const dates = budgetView === "monthly" ? range(true) : budgetView === "weekly" ? range(false) : [budgetCurrentDate, budgetCurrentDate];
    const people = activeBudgetProfile === "joint" ? BudgetMaster.PEOPLE : [activeBudgetProfile];
    panel.style.cssText = `display:grid;grid-template-columns:${people.length === 2 ? "1fr 1fr" : "1fr"};gap:10px;margin-bottom:10px`;
    panel.innerHTML = people.map(person => poolCard(person, dates[0], dates[1])).join("");
  }
  renderBudgetOverview = function () { legacyOverview(); renderPersonalPools(); };

  openPersonalPoolEntry = function (kind, person) {
    openAddExpenseSheet();
    if (document.getElementById("exp-owner")) document.getElementById("exp-owner").value = person;
    if (document.getElementById("exp-scope")) document.getElementById("exp-scope").value = "personal";
    if (kind === "spend") {
      pickExpType("variable", document.querySelector("#exp-type-badges [data-v='variable']"));
      document.getElementById("exp-title").value = "Personal spending";
    } else {
      pickExpType("savings", document.querySelector("#exp-type-badges [data-v='savings']"));
      const bucket = kind === "fund" ? "personal_pool" : "personal";
      const button = document.querySelector("#exp-sav-field [data-v='" + bucket + "']");
      if (button) pickSavBucket(bucket, button);
      document.getElementById("exp-title").value = kind === "fund" ? "Personal pool funding" : "Personal savings";
    }
  };

  const legacySettings = renderBudgetSettings;
  renderBudgetSettings = function () {
    legacySettings();
    const settingsHost = document.getElementById("btab-bsettings-content");
    let warning = document.getElementById("bm-duplicate-warning");
    if (settingsHost && !warning) {
      warning = document.createElement("div"); warning.id = "bm-duplicate-warning";
      settingsHost.prepend(warning);
    }
    const duplicates = jointMaster?.duplicateCandidates || [];
    if (warning) {
      warning.style.cssText = "display:" + (duplicates.length ? "block" : "none") + ";margin-bottom:12px;padding:10px 12px;border:1px solid #e0a040;border-radius:10px;background:rgba(224,160,64,.08);font-size:12px;color:var(--text)";
      warning.innerHTML = duplicates.length
        ? `<strong>Possible duplicates preserved:</strong> ${duplicates.map(item => item.name).join(", ")}. Nothing was merged or deleted; review these when convenient.`
        : "";
    }
    const all = [
      ...(budgetData.recurring.incomeSources || []), ...(budgetData.recurring.savingsTransfers || []),
      ...(budgetData.recurring.bills || []), ...(budgetData.recurring.subscriptions || [])
    ];
    document.querySelectorAll("#bs-income-sources .bs-item-card, #bs-savings-list .bs-item-card, #bs-bills-list .bs-item-card, #bs-subs-list .bs-item-card").forEach(card => {
      const nameNode = card.querySelector(".bs-item-name");
      if (!nameNode || nameNode.querySelector(".bm-owner-chip")) return;
      const item = all.find(candidate => candidate.name && card.textContent.includes(candidate.name));
      if (!item) return;
      const label = item.owner === "christian" ? "Christian" : item.owner === "britt" ? "Brittni" : "Household";
      nameNode.insertAdjacentHTML("beforeend", ` <span class="bm-owner-chip" style="font-size:9px;color:var(--muted);border:1px solid var(--border);border-radius:8px;padding:1px 5px">${label}${item.scope ? " · " + item.scope : ""}</span>`);
    });
  };
}
