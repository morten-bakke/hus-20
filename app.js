// =============================================================================
// Boligkalkulator Oslo — Application Logic
// =============================================================================

(function () {
  // ---------------------------------------------------------------------------
  // SSB Oslo housing price data (boligprisindeksen, 2015=100)
  // Fallback data — replaced by live SSB API data on load if available
  // Source: SSB table 07230 — Prisindeks for brukte boliger, Oslo med Bærum
  // ---------------------------------------------------------------------------
  let OSLO_PRICE_HISTORY = [
    { year: 2010, index: 66, change: 8.3 },
    { year: 2011, index: 73, change: 9.0 },
    { year: 2012, index: 79, change: 7.7 },
    { year: 2013, index: 83, change: 5.5 },
    { year: 2014, index: 90, change: 8.1 },
    { year: 2015, index: 100.0, change: 11.1 },
    { year: 2016, index: 112, change: 12.0 },
    { year: 2017, index: 110, change: -1.5 },
    { year: 2018, index: 113, change: 2.5 },
    { year: 2019, index: 116, change: 2.5 },
    { year: 2020, index: 126, change: 8.7 },
    { year: 2021, index: 139, change: 10.0 },
    { year: 2022, index: 136, change: -2.0 },
    { year: 2023, index: 135, change: -0.5 },
    { year: 2024, index: 139, change: 2.5 },
  ];

  // Fetch live data from SSB API (table 07230 — Oslo med Bærum, all dwelling types)
  async function fetchSSBData() {
    const url = 'https://data.ssb.no/api/v0/no/table/07230';
    const query = {
      query: [
        { code: 'Boligtype', selection: { filter: 'item', values: ['00'] } },  // All types
        { code: 'Region', selection: { filter: 'item', values: ['0301'] } },    // Oslo
        { code: 'ContentsCode', selection: { filter: 'item', values: ['Indeks'] } },
        { code: 'Tid', selection: { filter: 'top', values: ['20'] } },          // Last 20 years
      ],
      response: { format: 'json-stat2' },
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      });
      if (!resp.ok) return false;
      const data = await resp.json();

      const years = Object.keys(data.dimension.Tid.category.label).map(Number);
      const values = data.value;
      const parsed = years.map((year, i) => ({
        year,
        index: values[i],
        change: i > 0 && values[i - 1] ? Math.round((values[i] / values[i - 1] - 1) * 1000) / 10 : 0,
      })).filter((d) => d.index != null);

      if (parsed.length > 3) {
        OSLO_PRICE_HISTORY = parsed;
        document.getElementById('ssb-source-note').textContent = `Live data fra SSB API (tabell 07230). Sist hentet: ${new Date().toLocaleDateString('nb-NO')}`;
        return true;
      }
    } catch (e) {
      console.warn('SSB API fetch failed, using fallback data:', e);
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // SIFO Referansebudsjettet (OsloMet/SIFO)
  // "couple" verified against 2026 figures (kryssjekket mot Fimly.no, som
  // stemte eksakt med oppgitt sum). De fire andre husholdningstypene er
  // fortsatt 2025-tall — fant ingen pålitelig kilde for 2026-tallene deres
  // (ligger bak SIFOs interaktive kalkulator, ikke skrapet).
  // Source: https://www.oslomet.no/om/sifo/referansebudsjettet
  // All amounts NOK/month. Does NOT include housing, electricity, vacation.
  // ---------------------------------------------------------------------------
  const SIFO = {
    single: {
      label: 'Enslig', // 2025-tall, ikke oppdatert til 2026
      mat: 4680, klar: 1085, helse: 895, fritid: 1060, kollektivt: 985,
      dagligvarer: 435, husholdsart: 585, mobler: 565, medier: 2520,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
    couple: {
      label: 'Par uten barn', // 2026-tall, verifisert
      mat: 9040, klar: 2210, helse: 1840, fritid: 2160, kollektivt: 2038,
      dagligvarer: 450, husholdsart: 640, mobler: 680, medier: 2620,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
    couple_1child: {
      label: 'Par + 1 barn', // 2025-tall, ikke oppdatert til 2026
      mat: 11570, klar: 3050, helse: 2150, fritid: 2910, kollektivt: 1970,
      dagligvarer: 660, husholdsart: 720, mobler: 760, medier: 2700,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
    couple_2children: {
      label: 'Par + 2 barn', // 2025-tall, ikke oppdatert til 2026
      mat: 14410, klar: 4040, helse: 2410, fritid: 4140, kollektivt: 2297,
      dagligvarer: 790, husholdsart: 915, mobler: 980, medier: 2790,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
    couple_3children: {
      label: 'Par + 3 barn', // 2025-tall, ikke oppdatert til 2026
      mat: 15787, klar: 4880, helse: 2780, fritid: 5680, kollektivt: 2624,
      dagligvarer: 900, husholdsart: 990, mobler: 1145, medier: 2820,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    // Fakta i saken — fra kjøpekontrakt og sluttoppgjør
    apartmentSalePrice: 10_700_000, // salgssum ved oppgjør (sluttoppgjør leilighet)
    housePurchasePrice: 14_500_000, // kjøpesum ved overdragelse (skjøte/kjøpekontrakt hus)
    currentLoan: 8_040_000, // innfridd ved salg av leilighet
    realtorPct: 0.9,
    realtorFixed: 79_140, // vederlag 62 370 + utlegg 10 045 + tillegg 6 725
    savings: 1_800_000, // oppsparte midler: sparekonto, BSU, aksjer, fond
    carValue: 600_000, // bil uten heftelser — grovt anslag, likviditetsreserve (ikke en del av lånesøknaden)
    studentLoan: 1_000_000,
    studentLoanRate: 4.6,
    studentLoanTermYears: 20,
    grossIncome: 2_150_000,
    incomeSplit: 0.50,
    newKommunale: 2500,
    newInsurance: 800,
    newMaintenance: 1000,
    newOther: 1000,
    monthlyElectricity: 3000,
    monthlyCarCost: 3375, // 1 fossilbil — SIFO 2026 sin egen bilkostnadskategori (tillegg til basisbudsjettet)
    householdType: 'couple',

    // Forhandlingsvariabler — det som fortsatt er til diskusjon med banken
    interestRate: 4.99, // BN Bank finansieringsbevis, langsiktig lån (13.04.2026)
    bnBankLoan: 11_500_000, // lånebeløp i dagens finansieringsbevis fra BN Bank — referanse vi forhandler opp fra
    loanTermYears: 30,
    desiredLoan: null, // set at init — default: don't touch savings beyond salgs-EK

    // Utleie (hybel)
    monthlyRentalIncome: 15_000,
    rentalIncomeWeight: 0.8, // bankens vekting av dokumentert leieinntekt
    ownerOccupiedShare: 0.8, // andel dere selv bruker — avgjør skattefritak
  };

  const NOK = (v) => new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(v);
  const PCT = (v) => (v * 100).toFixed(1) + '%';

  // ---------------------------------------------------------------------------
  // DOM binding
  // ---------------------------------------------------------------------------
  function bindInputs() {
    document.querySelectorAll('[data-bind]').forEach((el) => {
      const key = el.dataset.bind;
      const multiplier = parseFloat(el.dataset.mult || '1');

      // Set initial value
      if (el.type === 'range') {
        el.value = state[key] / multiplier;
      } else if (el.type === 'number') {
        el.value = state[key] / multiplier;
      }

      el.addEventListener('input', () => {
        const val = parseFloat(el.value) * multiplier;
        if (!isNaN(val)) {
          state[key] = val;
          // Sync paired slider/number inputs
          document.querySelectorAll(`[data-bind="${key}"]`).forEach((other) => {
            if (other !== el) {
              other.value = val / (parseFloat(other.dataset.mult || '1'));
            }
          });
          // Update display values
          document.querySelectorAll(`[data-display="${key}"]`).forEach((disp) => {
            disp.textContent = formatDisplayValue(key, val);
          });
          requestAnimationFrame(recalculateAll);
        }
      });
    });
  }

  function formatDisplayValue(key, val) {
    if (key === 'incomeSplit') return Math.round(val * 100) + '/' + Math.round((1 - val) * 100);
    if (key === 'rentalIncomeWeight' || key === 'ownerOccupiedShare') return Math.round(val * 100) + '%';
    if (key === 'interestRate') return val.toFixed(2) + '%';
    if (key === 'loanTermYears') return val + ' år';
    return 'kr ' + NOK(val);
  }

  // ---------------------------------------------------------------------------
  // Tab navigation
  // ---------------------------------------------------------------------------
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
      });
    });
  }

  // Sets the "Ønsket lån" slider bounds and its default value (minimum loan
  // that avoids touching savings beyond the apartment-sale equity), based on
  // the fixed facts in state. Must run before bindInputs() reads state.desiredLoan.
  function initDesiredLoan() {
    const annualRental = state.monthlyRentalIncome * 12;
    const base = Calc.calculateEquityPosition({
      apartmentSalePrice: state.apartmentSalePrice,
      housePurchasePrice: state.housePurchasePrice,
      grossIncome: state.grossIncome,
      currentLoan: state.currentLoan,
      realtorPct: state.realtorPct,
      realtorFixed: state.realtorFixed,
      annualRentalIncome: annualRental,
      rentalIncomeWeight: state.rentalIncomeWeight,
      savings: state.savings,
      otherDebt: state.studentLoan,
    });
    // Default to the 12,5 mill. vi faktisk ber DNB om — bevisst over minimum
    // for å beholde oppsparte midler som buffer. Klemt innenfor slider-grensene.
    const targetLoan = 12_500_000;
    state.desiredLoan = Math.min(base.totalPurchaseCost, Math.max(base.minLoan, targetLoan));
    const slider = document.querySelector('input[data-bind="desiredLoan"]');
    if (slider) {
      slider.min = base.minLoan;
      slider.max = base.totalPurchaseCost;
    }
  }

  function initHouseholdSelect() {
    const sel = document.getElementById('household-select');
    if (sel) {
      sel.value = state.householdType;
      sel.addEventListener('change', () => {
        state.householdType = sel.value;
        requestAnimationFrame(recalculateAll);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Recalculate everything
  // ---------------------------------------------------------------------------
  function recalculateAll() {
    const annualRental = state.monthlyRentalIncome * 12;

    // 1. Equity position
    const equity = Calc.calculateEquityPosition({
      apartmentSalePrice: state.apartmentSalePrice,
      housePurchasePrice: state.housePurchasePrice,
      grossIncome: state.grossIncome,
      currentLoan: state.currentLoan,
      realtorPct: state.realtorPct,
      realtorFixed: state.realtorFixed,
      annualRentalIncome: annualRental,
      rentalIncomeWeight: state.rentalIncomeWeight,
      savings: state.savings,
      otherDebt: state.studentLoan,
      desiredLoan: state.desiredLoan,
    });

    // 2. Tax
    const tax = Calc.calculateHouseholdTax(state.grossIncome, state.incomeSplit);
    const rentalTax = Calc.calculateRentalIncomeTax(annualRental, state.ownerOccupiedShare);

    // 3. Affordability
    const afford = Calc.calculateAffordability(
      equity.loanNeeded, state.interestRate, state.loanTermYears,
      state.grossIncome, tax.totalNet, rentalTax.net
    );

    // 4. Rate sensitivity
    const sensitivity = Calc.rateSensitivity(
      equity.loanNeeded, state.loanTermYears, state.interestRate,
      state.grossIncome, tax.totalNet, rentalTax.net
    );

    // 5. Monthly housing cost (new home)
    const costs = Calc.monthlyHousingCost({
      loan: equity.loanNeeded,
      rate: state.interestRate,
      termYears: state.loanTermYears,
      kommunale: state.newKommunale,
      insurance: state.newInsurance,
      maintenance: state.newMaintenance,
      other: state.newOther,
      monthlyRentalIncome: state.monthlyRentalIncome,
    });

    // 6. Amortization
    const amortization = Calc.amortizationSchedule(equity.loanNeeded, state.interestRate, state.loanTermYears);

    // 7. Shared bank-view numbers (stress rate, SIFO) — used by dashboard,
    //    cash flow tab and the bank-case verdict, computed once so the
    //    figures we show the bank are consistent everywhere.
    const sifo = SIFO[state.householdType];
    const monthlyNetIncome = Math.round(tax.totalNet / 12);
    const fixedHousingCosts = state.newKommunale + state.newInsurance + state.newMaintenance + state.newOther;
    const studentLoanMonthly = state.studentLoan > 0
      ? Calc.annuity(state.studentLoan, state.studentLoanRate, state.studentLoanTermYears).monthly : 0;
    const sifoWithCar = sifo.total + state.monthlyCarCost; // SIFO basisbudsjett + SIFOs egen bilkostnadskategori
    const bankHousingStress = afford.monthlyPaymentStress + fixedHousingCosts - state.monthlyRentalIncome;
    const bankRemaining = Math.round(monthlyNetIncome - bankHousingStress - studentLoanMonthly - sifoWithCar - state.monthlyElectricity);
    const bankPasses = bankRemaining >= 0;
    const bankCtx = {
      sifo, sifoWithCar, monthlyNetIncome, fixedHousingCosts, studentLoanMonthly,
      stressMonthlyPayment: afford.monthlyPaymentStress,
      bankRemaining, bankPasses,
    };

    // 8. Rental income sensitivity — proves the loan holds up well below the
    //    expected kr 15 000/mnd from the hybel.
    const rentalSensitivity = Calc.rentalIncomeSensitivity({
      expectedMonthlyRental: state.monthlyRentalIncome,
      grossIncome: state.grossIncome,
      loanNeeded: equity.loanNeeded,
      otherDebt: equity.otherDebt,
      rentalIncomeWeight: state.rentalIncomeWeight,
      netIncomeMonthly: monthlyNetIncome,
      monthlyPayment: afford.monthlyPaymentCurrent, // dagens rente — ikke stresstest, for å ikke blande scenarioene
      fixedHousingCosts,
      sifoTotal: sifoWithCar,
      electricity: state.monthlyElectricity,
      studentLoanMonthly,
    });

    // --- Render ---
    renderFacts();
    renderDashboard(equity, afford, bankCtx);
    renderOppgjor(equity);
    renderDebtRatio(equity);
    renderBankCaseVerdict(equity, bankCtx);
    renderRentalSensitivity(rentalSensitivity, state.monthlyRentalIncome);
    renderSensitivityTable(sensitivity);
    renderRateSavingsCallout(sensitivity);
    renderCashFlowDetails(tax, costs, rentalTax, bankCtx);

    // 9. Resilience curve — bank/SIFO liquidity surplus as a function of the
    //    mortgage rate, so the 3pp stress test is one point on a continuum and
    //    the break-even rate (the actual "tåleevne") is visible.
    const resilience = Calc.resilienceCurve({
      loanNeeded: equity.loanNeeded,
      termYears: state.loanTermYears,
      currentRate: state.interestRate,
      netIncomeMonthly: monthlyNetIncome,
      fixedHousingCosts,
      monthlyRentalIncome: state.monthlyRentalIncome,
      studentLoanMonthly,
      sifoMonthly: sifoWithCar,
      electricity: state.monthlyElectricity,
    });
    renderResilienceNote(resilience);

    // --- Render charts ---
    Charts.renderRateSensitivity('chart-sensitivity', sensitivity);
    Charts.renderAmortization('chart-amortization', amortization);
    Charts.renderPriceHistory('chart-pricehistory', OSLO_PRICE_HISTORY);

    const grossHousing = costs.mortgage + costs.kommunale + costs.insurance + costs.maintenance + costs.other;
    const cashFlowData = {
      grossIncome: Math.round(state.grossIncome / 12),
      tax: Math.round(tax.totalTax / 12),
      netIncome: monthlyNetIncome,
      housingCosts: grossHousing,
      rentalIncome: costs.rentalIncome,
      studentLoan: studentLoanMonthly,
      sifoCosts: sifoWithCar,
      electricity: state.monthlyElectricity,
      remaining: monthlyNetIncome - costs.total - sifoWithCar - state.monthlyElectricity - studentLoanMonthly,
    };
    Charts.renderCashFlow('chart-cashflow', cashFlowData);
    Charts.renderResilience('chart-resilience', resilience);

    // 10. DNB application tab — reuses the canonical tables (mirrored) and
    //     renders second chart instances into its own canvases.
    renderDnbTab(equity, bankCtx, afford, resilience, cashFlowData);
  }

  // ---------------------------------------------------------------------------
  // Render functions
  // ---------------------------------------------------------------------------
  function renderFacts() {
    const rows = [
      ['Salgssum leilighet', 'kr ' + NOK(state.apartmentSalePrice)],
      ['Kjøpesum hus', 'kr ' + NOK(state.housePurchasePrice)],
      ['Innfridd lån (leilighet)', 'kr ' + NOK(state.currentLoan)],
      ['Meglerkostnad salg', state.realtorPct + '% + kr ' + NOK(state.realtorFixed)],
      ['Sparepenger/fond/aksjer', 'kr ' + NOK(state.savings)],
      ['Studielån', 'kr ' + NOK(state.studentLoan) + ' (' + state.studentLoanRate + '%, ' + state.studentLoanTermYears + ' år)'],
      ['Brutto husholdningsinntekt', 'kr ' + NOK(state.grossIncome)],
      ['Inntektsfordeling', Math.round(state.incomeSplit * 100) + '/' + Math.round((1 - state.incomeSplit) * 100)],
      ['Faste boutgifter (u/lån)', 'kr ' + NOK(state.newKommunale + state.newInsurance + state.newMaintenance + state.newOther) + '/mnd'],
      ['Strøm', 'kr ' + NOK(state.monthlyElectricity) + '/mnd'],
    ];
    setHtml('facts-grid', rows.map(([label, value]) => `
      <div>
        <div class="text-xs text-slate-400">${label}</div>
        <div class="font-semibold text-slate-800">${value}</div>
      </div>
    `).join(''));
  }

  function renderDashboard(eq, af, bankCtx) {
    // Equity card — equity actually contributed at the chosen loan level
    setHtml('dash-equity-value', 'kr ' + NOK(eq.totalEquity));
    const boligPortion = eq.totalEquity - eq.savingsUsed;
    const usedParts = [`bolig: ${NOK(boligPortion)}`];
    if (eq.savingsUsed > 0) usedParts.push(`sparing: ${NOK(eq.savingsUsed)}`);
    let equitySub = PCT(eq.equityPct) + ' av kjøpesum (krav: 10%) (' + usedParts.join(' + ') + ')';
    if (eq.savingsUnused > 0) equitySub += ` · kr ${NOK(eq.savingsUnused)} sparepenger ikke i bruk`;
    setHtml('dash-equity-sub', equitySub);
    setClass('dash-equity-badge', eq.equityMet ? 'badge-pass' : 'badge-fail');
    setHtml('dash-equity-badge', eq.equityMet ? 'Oppfylt' : 'Ikke oppfylt');

    // Loan needed card
    setHtml('dash-loan-value', 'kr ' + NOK(eq.loanNeeded));
    const debtNote = eq.otherDebt > 0
      ? `Boliglån: ${NOK(eq.loanNeeded)} + Studielån: ${NOK(eq.otherDebt)} = Total gjeld: ${NOK(eq.totalDebt)}`
      : 'Total kjøpskostnad: kr ' + NOK(eq.totalPurchaseCost);
    setHtml('dash-loan-sub', debtNote);

    // 5x income card — shows total debt vs max
    setHtml('dash-5x-value', 'kr ' + NOK(eq.maxTotalDebt5x));
    const gapText = eq.gap >= 0
      ? 'Margin: kr ' + NOK(eq.gap)
      : 'Mangler: kr ' + NOK(Math.abs(eq.gap));
    const debtBreakdown = eq.otherDebt > 0
      ? `Total gjeld: ${NOK(eq.totalDebt)} (${eq.debtToIncome}x) | ${gapText}`
      : `Gjeldsgrad: ${eq.debtToIncome}x | ${gapText}`;
    setHtml('dash-5x-sub', debtBreakdown);
    if (eq.effectiveIncome > state.grossIncome) {
      setHtml('dash-5x-rental', `Inkl. leieinntekt (${Math.round(state.rentalIncomeWeight * 100)}%): kr ${NOK(eq.effectiveIncome)}`);
    } else {
      setHtml('dash-5x-rental', '');
    }
    setClass('dash-5x-badge', eq.incomeRuleMet ? 'badge-pass' : 'badge-fail');
    setHtml('dash-5x-badge', eq.incomeRuleMet ? 'Oppfylt' : 'Trenger unntak');

    // Monthly cost card
    setHtml('dash-monthly-value', 'kr ' + NOK(af.monthlyPaymentCurrent) + '/mnd');
    setHtml('dash-monthly-sub', `Stresstest (${af.stressRate.toFixed(1)}%): kr ${NOK(af.monthlyPaymentStress)}/mnd`);
    const dsr = af.debtServiceRatioGross;
    setClass('dash-monthly-badge', dsr < 0.3 ? 'badge-pass' : dsr < 0.4 ? 'badge-warn' : 'badge-fail');
    setHtml('dash-monthly-badge', PCT(dsr) + ' av brutto');

    // SIFO / betjeningsevne card
    setHtml('dash-sifo-value', 'kr ' + NOK(bankCtx.bankRemaining) + '/mnd');
    const sifoSubParts = [`SIFO inkl. bil: ${NOK(bankCtx.sifoWithCar)}`];
    if (bankCtx.studentLoanMonthly > 0) sifoSubParts.push(`studielån: ${NOK(bankCtx.studentLoanMonthly)}`);
    sifoSubParts.push(`strøm: ${NOK(state.monthlyElectricity)}`);
    setHtml('dash-sifo-sub', sifoSubParts.join(' + '));
    setClass('dash-sifo-badge', bankCtx.bankPasses ? 'badge-pass' : 'badge-fail');
    setHtml('dash-sifo-badge', bankCtx.bankPasses ? 'Likviditet OK' : 'Ikke nok til overs');
  }

  function renderOppgjor(eq) {
    const tx = eq.transactionCosts;
    const boligPortion = eq.totalEquity - eq.savingsUsed;

    setHtml('oppgjor-sale', `
      <tr><td>Salgssum leilighet</td><td class="number">kr ${NOK(state.apartmentSalePrice)}</td></tr>
      <tr><td>- Innfridd lån</td><td class="number">kr ${NOK(state.currentLoan)}</td></tr>
      <tr><td>- Meglerkostnad (${state.realtorPct}% + kr ${NOK(state.realtorFixed)})</td><td class="number">kr ${NOK(tx.sellingCosts.realtorFee)}</td></tr>
      <tr class="highlight"><td><strong>= Fri egenkapital fra salget</strong></td><td class="number"><strong>kr ${NOK(eq.equityFromSale)}</strong></td></tr>
    `);

    setHtml('oppgjor-purchase', `
      <tr><td>Kjøpesum hus</td><td class="number">kr ${NOK(state.housePurchasePrice)}</td></tr>
      <tr><td>+ Dokumentavgift (2,5%)</td><td class="number">kr ${NOK(tx.buyingCosts.dokumentavgift)}</td></tr>
      <tr><td>+ Tinglysning</td><td class="number">kr ${NOK(tx.buyingCosts.tinglysning)}</td></tr>
      <tr><td>+ Boligkjøperforsikring</td><td class="number">kr ${NOK(tx.buyingCosts.boligkjoperforsikring)}</td></tr>
      <tr class="highlight"><td><strong>= Totalpris</strong></td><td class="number"><strong>kr ${NOK(eq.totalPurchaseCost)}</strong></td></tr>
    `);

    const total = boligPortion + eq.savingsUsed + eq.loanNeeded;
    const pct = (v) => total > 0 ? Math.round((v / total) * 100) + '%' : '—';
    setHtml('oppgjor-financing', `
      <tr><td>Fri EK fra salg av leilighet</td><td class="number">kr ${NOK(boligPortion)}</td><td class="number">${pct(boligPortion)}</td></tr>
      <tr><td>Sparepenger/fond/aksjer</td><td class="number">kr ${NOK(eq.savingsUsed)}</td><td class="number">${pct(eq.savingsUsed)}</td></tr>
      <tr><td>Lån (ønsket)</td><td class="number">kr ${NOK(eq.loanNeeded)}</td><td class="number">${pct(eq.loanNeeded)}</td></tr>
      <tr class="highlight"><td><strong>= Totalpris</strong></td><td class="number"><strong>kr ${NOK(total)}</strong></td><td></td></tr>
    `);

    Charts.renderFinancingBreakdown('chart-financing', {
      saleEquity: boligPortion,
      savings: eq.savingsUsed,
      loan: eq.loanNeeded,
    });
  }

  function renderDebtRatio(eq) {
    const annualRental = state.monthlyRentalIncome * 12;
    const rentalWeighted = annualRental * state.rentalIncomeWeight;
    const weightPct = Math.round(state.rentalIncomeWeight * 100);
    setHtml('detail-debt-ratio', `
      <tr><td>Brutto lønnsinntekt</td><td class="number">kr ${NOK(state.grossIncome)}</td></tr>
      ${annualRental > 0 ? `<tr><td>+ Leieinntekt (${weightPct} % vektet)</td><td class="number">kr ${NOK(rentalWeighted)}</td></tr>` : ''}
      <tr class="highlight"><td><strong>= Beregnet inntekt</strong></td><td class="number"><strong>kr ${NOK(eq.effectiveIncome)}</strong></td></tr>
      <tr><td>Maks total gjeld (5x inntekt)</td><td class="number">kr ${NOK(eq.maxTotalDebt5x)}</td></tr>
      <tr><td colspan="2" style="padding: 2px"></td></tr>
      <tr><td>Ønsket lån</td><td class="number">kr ${NOK(eq.loanNeeded)}</td></tr>
      ${eq.otherDebt > 0 ? `<tr><td>+ Studielån</td><td class="number">kr ${NOK(eq.otherDebt)}</td></tr>` : ''}
      <tr class="highlight"><td><strong>= Total gjeld</strong></td><td class="number"><strong>kr ${NOK(eq.totalDebt)}</strong></td></tr>
      <tr class="${eq.gap >= 0 ? 'feasible-row' : 'stress-row'}">
        <td><strong>${eq.gap >= 0 ? 'Margin' : 'Over 5x-taket'}</strong></td>
        <td class="number"><strong>kr ${NOK(Math.abs(eq.gap))}</strong></td></tr>
    `);
  }

  function renderBankCaseVerdict(eq, bankCtx) {
    const criteria = [
      { label: 'Egenkapital (10%-krav)', met: eq.equityMet },
      { label: '5x inntektsregel', met: eq.incomeRuleMet },
      { label: 'Likviditet ved stresstest (SIFO)', met: bankCtx.bankPasses },
    ];
    setHtml('bankcase-criteria', criteria.map((c) => `
      <div class="text-center">
        <span class="inline-block px-2 py-0.5 rounded text-xs font-semibold ${c.met ? 'badge-pass' : 'badge-fail'}">${c.met ? 'Bestått' : 'Ikke bestått'}</span>
        <div class="text-xs text-slate-500 mt-1">${c.label}</div>
      </div>
    `).join(''));
    const allPass = criteria.every((c) => c.met);
    setHtml('bankcase-verdict', allPass ? 'Sterk sak' : 'Trenger oppmerksomhet');
    setClass('bankcase-verdict', allPass ? 'badge-pass' : 'badge-warn');
  }

  function renderRentalSensitivity(data, expected) {
    let rows = '';
    data.forEach((d) => {
      const label = d.monthlyRental === 0
        ? 'kr 0/mnd (ingen leietaker)'
        : d.isExpected
          ? `kr ${NOK(d.monthlyRental)}/mnd (forventet)`
          : `kr ${NOK(d.monthlyRental)}/mnd`;
      rows += `<tr class="${d.passes ? 'feasible-row' : 'stress-row'}">
        <td>${label}</td>
        <td class="number ${d.passes ? 'ratio-good' : 'ratio-bad'}">kr ${NOK(d.bankRemaining)}/mnd</td>
        <td class="number ${d.incomeRuleMet ? 'ratio-good' : 'ratio-bad'}">${d.gap >= 0 ? '+' : ''}kr ${NOK(d.gap)}</td>
        <td>${d.passes ? 'Likviditet OK' : 'Ikke nok til overs'}</td>
      </tr>`;
    });
    setHtml('rental-sensitivity-body', rows);

    const zero = data.find((d) => d.monthlyRental === 0);
    const atExpected = data.find((d) => d.isExpected) || data[data.length - 1];
    if (zero) {
      let note = zero.passes
        ? `Likviditeten holder selv uten leieinntekt fra hybelen — kr ${NOK(zero.bankRemaining)}/mnd til overs i verste fall. Leieinntekten på kr ${NOK(expected)}/mnd er en ekstra buffer, ikke en forutsetning for betjeningsevnen.`
        : `Uten leieinntekt mangler dere kr ${NOK(Math.abs(zero.bankRemaining))}/mnd i likviditetsoverskudd — leieinntekten på kr ${NOK(expected)}/mnd er nødvendig for at kontantstrømmen skal gå opp.`;
      if (atExpected && !atExpected.incomeRuleMet) {
        note += ' Merk: 5x-regelen krever uansett unntak fra banken uavhengig av leienivå — se «Maks lån»-kortet over.';
      }
      setHtml('rental-sensitivity-note', note);
    }
  }

  function renderSensitivityTable(data) {
    let rows = '';
    data.forEach((d) => {
      const cls = d.isStressTest ? 'stress-row' : d.isCurrentRate ? 'highlight' : '';
      const ratioClass = d.debtServiceRatioGross < 0.3 ? 'ratio-good' : d.debtServiceRatioGross < 0.4 ? 'ratio-warn' : 'ratio-bad';
      rows += `<tr class="${cls}">
        <td>${d.rate.toFixed(1)}%${d.isCurrentRate ? ' (nå)' : ''}${d.isStressTest ? ' (stress)' : ''}</td>
        <td class="number">kr ${NOK(d.monthlyPayment)}</td>
        <td class="number">kr ${NOK(d.annualCost)}</td>
        <td class="number ${ratioClass}">${PCT(d.debtServiceRatioGross)}</td>
        <td class="number ${d.housingCostRatioNet > 0.5 ? 'ratio-bad' : d.housingCostRatioNet > 0.35 ? 'ratio-warn' : 'ratio-good'}">${PCT(d.housingCostRatioNet)}</td>
      </tr>`;
    });
    setHtml('sensitivity-table-body', rows);
  }

  function renderRateSavingsCallout(data) {
    const current = data.find((d) => d.isCurrentRate);
    const lower05 = data.find((d) => d.offset === -0.5);
    const lower10 = data.find((d) => d.offset === -1.0);
    if (!current || !lower05 || !lower10) return;
    const save05 = current.monthlyPayment - lower05.monthlyPayment;
    const save10 = current.monthlyPayment - lower10.monthlyPayment;
    setHtml('rate-savings-callout', `
      <h3 class="text-sm font-bold text-emerald-800 mb-2">Hva en bedre rente er verdt</h3>
      <p class="text-xs text-emerald-700">
        Fra dagens ${current.rate.toFixed(1)} %: 0,5 %-poeng lavere rente (${lower05.rate.toFixed(1)} %) sparer
        <strong>kr ${NOK(save05)}/mnd</strong> (kr ${NOK(save05 * 12)}/år).
        1,0 %-poeng lavere (${lower10.rate.toFixed(1)} %) sparer <strong>kr ${NOK(save10)}/mnd</strong> (kr ${NOK(save10 * 12)}/år).
      </p>
    `);
  }

  function renderResilienceNote(r) {
    const el = document.getElementById('resilience-note');
    if (!el) return;
    const c = (v, dec) => v.toFixed(dec).replace('.', ',');
    const lastRate = r.points[r.points.length - 1].rate;
    let txt;
    if (r.breakEvenRate == null) {
      txt = `Likviditetsoverskuddet holder seg positivt i hele det viste renteintervallet (opp til ${c(lastRate, 1)} %). `
        + `Ved 3 pp-stresstesten (${c(r.stressRate, 1)} %) er det kr ${NOK(r.stressSurplus)}/mnd til overs.`;
    } else if (r.headroomPP >= 0) {
      const stressInside = r.stressRate <= r.breakEvenRate;
      txt = `Renten kan stige til ${c(r.breakEvenRate, 2)} % — +${c(r.headroomPP, 2)} prosentpoeng fra dagens ${c(r.currentRate, 2)} % — `
        + `før likviditetsoverskuddet blir null. 3 pp-stresstesten på ${c(r.stressRate, 1)} % ligger `
        + (stressInside
          ? `innenfor tåleevnen (kr ${NOK(r.stressSurplus)}/mnd til overs).`
          : `utenfor tåleevnen (kr ${NOK(Math.abs(r.stressSurplus))}/mnd i underskudd).`);
    } else {
      txt = `Dagens rente (${c(r.currentRate, 2)} %) ligger allerede over tåleevnen på ${c(r.breakEvenRate, 2)} % — `
        + `likviditetsoverskuddet er negativt. 3 pp-stresstesten på ${c(r.stressRate, 1)} % gir kr ${NOK(Math.abs(r.stressSurplus))}/mnd i underskudd.`;
    }
    el.textContent = txt;
  }

  function renderDnbTab(eq, bankCtx, afford, resilience, cashFlowData) {
    if (!document.getElementById('tab-dnb')) return;
    const boligPortion = eq.totalEquity - eq.savingsUsed;
    const bufferKept = Math.max(0, eq.savings - eq.savingsUsed);
    const ltv = eq.loanNeeded / state.housePurchasePrice;
    const over5x = eq.incomeRuleMet ? 0 : Math.abs(eq.gap);
    const loanIncrease = eq.loanNeeded - state.bnBankLoan;
    const stressRateTxt = afford.stressRate.toFixed(1).replace('.', ',') + ' %';
    const carValueTxt = 'kr ' + NOK(state.carValue);
    const savingsTotalTxt = 'kr ' + NOK(state.savings);
    const setTextAll = (ids, txt) => ids.forEach((id) => setText(id, txt));

    // Live figures woven into the prose
    setText('dnb-purchase', 'kr ' + NOK(state.housePurchasePrice));
    setText('dnb-sale-price', 'kr ' + NOK(state.apartmentSalePrice));
    setText('dnb-bn-loan', 'kr ' + NOK(state.bnBankLoan));
    setText('dnb-loan', 'kr ' + NOK(eq.loanNeeded));
    setText('dnb-loan-subject', 'kr ' + NOK(eq.loanNeeded));
    setText('dnb-loan-increase', (loanIncrease >= 0 ? '+kr ' : '−kr ') + NOK(Math.abs(loanIncrease)));
    setText('dnb-ek-amount', 'kr ' + NOK(eq.totalEquity));
    setText('dnb-ek-pct', PCT(eq.equityPct));
    setText('dnb-ltv', PCT(ltv));
    setText('dnb-savings', 'kr ' + NOK(bufferKept));
    setText('dnb-unntak', over5x > 0 ? 'kr ' + NOK(over5x) : 'ingenting — innenfor taket');
    setText('dnb-stress-rate', stressRateTxt);
    setText('dnb-income', 'kr ' + NOK(state.grossIncome));
    setTextAll(['dnb-savings-2', 'dnb-savings-3', 'dnb-savings-4', 'dnb-savings-5'], savingsTotalTxt);
    setTextAll(['dnb-car-value', 'dnb-car-value-2', 'dnb-car-value-3'], carValueTxt);
    setText('dnb-current-rate', state.interestRate.toFixed(2).replace('.', ',') + ' %');
    setText('dnb-loan-term', String(state.loanTermYears));
    setText('dnb-rental-income', 'kr ' + NOK(state.monthlyRentalIncome));

    // Mirror the canonical tables so they stay in sync with the sliders
    mirrorInto('oppgjor-sale', 'dnb-sale');

    // Combined purchase + financing table
    const tx = eq.transactionCosts;
    const total = boligPortion + eq.savingsUsed + eq.loanNeeded;
    const pct = (v) => total > 0 ? Math.round((v / total) * 100) + '%' : '—';
    setHtml('dnb-purchase-financing', `
      <tr><td>Kjøpesum hus</td><td class="number">kr ${NOK(state.housePurchasePrice)}</td></tr>
      <tr><td>+ Dokumentavgift (2,5 %)</td><td class="number">kr ${NOK(tx.buyingCosts.dokumentavgift)}</td></tr>
      <tr><td>+ Tinglysning</td><td class="number">kr ${NOK(tx.buyingCosts.tinglysning)}</td></tr>
      <tr><td>+ Boligkjøperforsikring</td><td class="number">kr ${NOK(tx.buyingCosts.boligkjoperforsikring)}</td></tr>
      <tr class="highlight"><td><strong>= Totalpris</strong></td><td class="number"><strong>kr ${NOK(eq.totalPurchaseCost)}</strong></td></tr>
      <tr><td colspan="2" style="padding: 2px"></td></tr>
      <tr><td>Fri EK fra salg av leilighet</td><td class="number">kr ${NOK(boligPortion)}</td></tr>
      <tr><td>Sparepenger/fond/aksjer</td><td class="number">kr ${NOK(eq.savingsUsed)}</td></tr>
      <tr><td>Nytt lån (ønsket)</td><td class="number">kr ${NOK(eq.loanNeeded)}</td></tr>
      <tr class="highlight"><td><strong>= Totalpris</strong></td><td class="number"><strong>kr ${NOK(total)}</strong></td></tr>
    `);
    mirrorInto('detail-debt-ratio', 'dnb-debt-ratio');
    mirrorInto('cashflow-details', 'dnb-cashflow');
    const rnSrc = document.getElementById('resilience-note');
    const rnTgt = document.getElementById('dnb-resilience-note');
    if (rnSrc && rnTgt) rnTgt.textContent = rnSrc.textContent;

    Charts.renderCashFlow('dnb-chart-cashflow', cashFlowData);
    Charts.renderResilience('dnb-chart-resilience', resilience);
  }

  function renderCashFlowDetails(tax, costs, rentalTax, bankCtx) {
    const monthlyNet = bankCtx.monthlyNetIncome;
    const monthlyRental = state.monthlyRentalIncome;
    const grossHousing = costs.mortgage + costs.kommunale + costs.insurance + costs.maintenance + costs.other;
    const sifo = bankCtx.sifo;
    const electricity = state.monthlyElectricity;
    const carCost = state.monthlyCarCost;
    const studentLoanMonthly = bankCtx.studentLoanMonthly;

    // Own view, at today's rate (not stress-tested) — net of rental once
    const remaining = monthlyNet - costs.total - studentLoanMonthly - bankCtx.sifoWithCar - electricity;

    setHtml('cashflow-details', `
      <tr><td>Brutto inntekt</td><td class="number">kr ${NOK(Math.round(state.grossIncome / 12))}/mnd</td></tr>
      <tr><td>- Skatt (effektiv ${PCT(tax.effectiveRate)})</td><td class="number">kr ${NOK(Math.round(tax.totalTax / 12))}/mnd</td></tr>
      <tr class="highlight"><td><strong>Netto inntekt</strong></td><td class="number"><strong>kr ${NOK(monthlyNet)}/mnd</strong></td></tr>
      <tr><td>- Boutgifter ny bolig</td><td class="number">kr ${NOK(grossHousing)}/mnd</td></tr>
      ${studentLoanMonthly > 0 ? `<tr><td>- Studielån (${state.studentLoanRate}%, ${state.studentLoanTermYears} år)</td><td class="number">kr ${NOK(studentLoanMonthly)}/mnd</td></tr>` : ''}
      ${monthlyRental > 0 ? `<tr><td>+ Leieinntekt${rentalTax.taxFree ? ' (skattefri)' : ''}</td><td class="number">kr ${NOK(monthlyRental)}/mnd</td></tr>` : ''}
      <tr><td>- SIFO levekostnader inkl. bil (${sifo.label})</td><td class="number">kr ${NOK(bankCtx.sifoWithCar)}/mnd</td></tr>
      <tr><td>- Strøm</td><td class="number">kr ${NOK(electricity)}/mnd</td></tr>
      <tr class="${remaining > 0 ? 'feasible-row' : 'stress-row'}">
        <td><strong>Til overs</strong></td><td class="number"><strong>kr ${NOK(remaining)}/mnd</strong></td></tr>
    `);

    // Bank's perspective (stress test rate)
    setHtml('bank-perspective', `
      <table class="data-table">
        <tr><td>Netto inntekt</td><td class="number">kr ${NOK(monthlyNet)}/mnd</td></tr>
        <tr><td>- Boliglån ved stresstest</td><td class="number">kr ${NOK(bankCtx.stressMonthlyPayment)}/mnd</td></tr>
        ${studentLoanMonthly > 0 ? `<tr><td>- Studielån (${NOK(state.studentLoan)}, ${state.studentLoanRate}%)</td><td class="number">kr ${NOK(studentLoanMonthly)}/mnd</td></tr>` : ''}
        <tr><td>- Andre boutgifter</td><td class="number">kr ${NOK(bankCtx.fixedHousingCosts)}/mnd</td></tr>
        ${monthlyRental > 0 ? `<tr><td>+ Leieinntekt</td><td class="number">kr ${NOK(monthlyRental)}/mnd</td></tr>` : ''}
        <tr><td>- SIFO levekostnader inkl. bil (${sifo.label})</td><td class="number">kr ${NOK(bankCtx.sifoWithCar)}/mnd</td></tr>
        <tr><td>- Strøm</td><td class="number">kr ${NOK(electricity)}/mnd</td></tr>
        <tr class="${bankCtx.bankPasses ? 'feasible-row' : 'stress-row'}">
          <td><strong>Likviditetsoverskudd</strong></td>
          <td class="number"><strong>kr ${NOK(bankCtx.bankRemaining)}/mnd</strong></td>
        </tr>
      </table>
    `);
    setHtml('bank-verdict', bankCtx.bankPasses ? 'Banken: Bestått' : 'Banken: Ikke bestått');
    setClass('bank-verdict', bankCtx.bankPasses ? 'badge-pass' : 'badge-fail');

    // SIFO breakdown
    setHtml('sifo-breakdown', `
      <table class="data-table">
        <tr><td>Mat og drikke</td><td class="number">kr ${NOK(sifo.mat)}</td></tr>
        <tr><td>Klær og sko</td><td class="number">kr ${NOK(sifo.klar)}</td></tr>
        <tr><td>Personlig pleie</td><td class="number">kr ${NOK(sifo.helse)}</td></tr>
        <tr><td>Lek og mediebruk</td><td class="number">kr ${NOK(sifo.fritid)}</td></tr>
        <tr><td>Kollektivtransport</td><td class="number">kr ${NOK(sifo.kollektivt)}</td></tr>
        <tr><td>Dagligvarer</td><td class="number">kr ${NOK(sifo.dagligvarer)}</td></tr>
        <tr><td>Husholdningsartikler</td><td class="number">kr ${NOK(sifo.husholdsart)}</td></tr>
        <tr><td>Møbler</td><td class="number">kr ${NOK(sifo.mobler)}</td></tr>
        <tr><td>Mediebruk og fritid</td><td class="number">kr ${NOK(sifo.medier)}</td></tr>
        <tr><td>Bil (1 fossilbil, SIFO 2026)</td><td class="number">kr ${NOK(carCost)}</td></tr>
        <tr class="highlight"><td><strong>Sum SIFO</strong></td><td class="number"><strong>kr ${NOK(bankCtx.sifoWithCar)}</strong></td></tr>
      </table>
    `);

    setHtml('tax-breakdown', `
      Person 1 (${Math.round(state.incomeSplit * 100)}%): Brutto kr ${NOK(tax.person1.gross)} → Netto kr ${NOK(tax.person1.net)} (${PCT(tax.person1.effectiveRate)} skatt)<br>
      Person 2 (${Math.round((1 - state.incomeSplit) * 100)}%): Brutto kr ${NOK(tax.person2.gross)} → Netto kr ${NOK(tax.person2.net)} (${PCT(tax.person2.effectiveRate)} skatt)
    `);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }
  function mirrorInto(srcId, dstId) {
    const src = document.getElementById(srcId);
    const dst = document.getElementById(dstId);
    if (src && dst) dst.innerHTML = src.innerHTML;
  }
  function setClass(id, cls) {
    const el = document.getElementById(id);
    if (el) {
      el.className = el.className.replace(/badge-\w+|ratio-\w+/g, '').trim();
      el.classList.add(cls);
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    initDesiredLoan();
    bindInputs();
    initTabs();
    initHouseholdSelect();
    recalculateAll();

    // Update all display values on load
    document.querySelectorAll('[data-display]').forEach((disp) => {
      const key = disp.dataset.display;
      disp.textContent = formatDisplayValue(key, state[key]);
    });

    // Fetch live SSB data in background, re-render market chart when done
    const fetched = await fetchSSBData();
    if (fetched) {
      Charts.renderPriceHistory('chart-pricehistory', OSLO_PRICE_HISTORY);
      // Update key stats from live data
      const len = OSLO_PRICE_HISTORY.length;
      if (len > 5) {
        const last5 = OSLO_PRICE_HISTORY.slice(-6);
        const avg5yr = ((last5[last5.length - 1].index / last5[0].index) ** (1 / 5) - 1) * 100;
        const allChanges = OSLO_PRICE_HISTORY.filter(d => d.change !== 0);
        const worst = allChanges.reduce((a, b) => a.change < b.change ? a : b);
        const best = allChanges.reduce((a, b) => a.change > b.change ? a : b);
        const avgAll = ((OSLO_PRICE_HISTORY[len - 1].index / OSLO_PRICE_HISTORY[0].index) ** (1 / (len - 1)) - 1) * 100;
        setHtml('stat-avg-all', '~' + avgAll.toFixed(1) + '%');
        setHtml('stat-avg-5yr', '~' + avg5yr.toFixed(1) + '%');
        setHtml('stat-worst', worst.change.toFixed(1) + '% (' + worst.year + ')');
        setHtml('stat-best', '+' + best.change.toFixed(1) + '% (' + best.year + ')');
      }
    }
  });
})();
