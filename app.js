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
  // SIFO Referansebudsjettet 2025 (OsloMet/SIFO)
  // Source: https://kalkulator.referansebudsjett.no
  // All amounts NOK/month. Does NOT include housing, electricity, vacation.
  // ---------------------------------------------------------------------------
  const SIFO = {
    single: {
      label: 'Enslig',
      mat: 4680, klar: 1085, helse: 895, fritid: 1060, kollektivt: 985,
      dagligvarer: 435, husholdsart: 585, mobler: 565, medier: 2520,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
    couple: {
      label: 'Par uten barn',
      mat: 9360, klar: 2170, helse: 1790, fritid: 2120, kollektivt: 1970,
      dagligvarer: 500, husholdsart: 635, mobler: 625, medier: 2560,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
    couple_1child: {
      label: 'Par + 1 barn',
      mat: 11570, klar: 3050, helse: 2150, fritid: 2910, kollektivt: 1970,
      dagligvarer: 660, husholdsart: 720, mobler: 760, medier: 2700,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
    couple_2children: {
      label: 'Par + 2 barn',
      mat: 14410, klar: 4040, helse: 2410, fritid: 4140, kollektivt: 2297,
      dagligvarer: 790, husholdsart: 915, mobler: 980, medier: 2790,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
    couple_3children: {
      label: 'Par + 3 barn',
      mat: 15787, klar: 4880, helse: 2780, fritid: 5680, kollektivt: 2624,
      dagligvarer: 900, husholdsart: 990, mobler: 1145, medier: 2820,
      get total() { return this.mat + this.klar + this.helse + this.fritid + this.kollektivt + this.dagligvarer + this.husholdsart + this.mobler + this.medier; }
    },
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    apartmentSalePrice: 11_000_000,
    housePurchasePrice: 15_000_000,
    grossIncome: 2_200_000,
    incomeSplit: 0.50,
    currentLoan: 8_000_000,
    interestRate: 5.0,
    loanTermYears: 30,
    renovationAmount: 5_000_000,
    propertyAppreciation: 3.5,
    salaryGrowth: 5.0,
    indexFundReturn: 7.0,
    realtorPct: 1.5,
    realtorFixed: 50_000,
    // Current apartment costs
    currentFellesutgifter: 5000,
    currentInsurance: 500,
    currentOther: 0,
    currentRate: 5.0,
    currentTermYears: 20,
    // New house costs
    newKommunale: 4000,
    newInsurance: 800,
    newMaintenance: 3000,
    newOther: 0,
    // Savings / additional equity
    savings: 1_000_000, // sparepenger, BSU, aksjer, fond
    // Other debt
    studentLoan: 1_000_000,
    studentLoanRate: 4.6,
    studentLoanTermYears: 20,
    // Rental income
    monthlyRentalIncome: 15_000,
    rentalIncomeWeight: 0.6, // bank weighting
    ownerOccupiedShare: 0.8, // for tax calculation
    // Apartment appreciation (for comparison — may differ from house)
    apartmentAppreciation: 3.5,
    // Household type for SIFO budget
    householdType: 'couple',
    // Electricity (not in SIFO)
    monthlyElectricity: 3000,
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
    if (key.includes('Rate') || key.includes('rate') || key === 'interestRate' || key === 'propertyAppreciation' ||
        key === 'salaryGrowth' || key === 'indexFundReturn' || key === 'incomeSplit' ||
        key === 'realtorPct' || key === 'rentalIncomeWeight' || key === 'ownerOccupiedShare' ||
        key === 'apartmentAppreciation') {
      if (key === 'incomeSplit') return Math.round(val * 100) + '/' + Math.round((1 - val) * 100);
      return val.toFixed(1) + '%';
    }
    if (key === 'loanTermYears' || key === 'currentTermYears') return val + ' år';
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

    // 5. Renovation timeline
    const renovation = Calc.renovationTimeline({
      initialPropertyValue: state.housePurchasePrice,
      initialLoan: equity.loanNeeded,
      grossIncome: state.grossIncome,
      appreciationRate: state.propertyAppreciation,
      salaryGrowthRate: state.salaryGrowth,
      renovationAmount: state.renovationAmount,
      interestRate: state.interestRate,
      loanTermYears: state.loanTermYears,
      annualRentalIncome: annualRental,
      rentalIncomeWeight: state.rentalIncomeWeight,
    });

    // 6. Cost comparison — same rate & term for fair comparison
    const costs = Calc.monthlyCostComparison({
      currentLoan: state.currentLoan,
      currentRate: state.interestRate,
      currentTermYears: state.loanTermYears,
      currentFellesutgifter: state.currentFellesutgifter,
      currentInsurance: state.currentInsurance,
      currentOther: state.currentOther,
      newLoan: equity.loanNeeded,
      newRate: state.interestRate,
      newTermYears: state.loanTermYears,
      newKommunale: state.newKommunale,
      newInsurance: state.newInsurance,
      newMaintenance: state.newMaintenance,
      newOther: state.newOther,
      monthlyRentalIncome: state.monthlyRentalIncome,
    });

    // 7. Net worth
    const netWorth = Calc.netWorthTrajectory({
      propertyValue: state.housePurchasePrice,
      loan: equity.loanNeeded,
      interestRate: state.interestRate,
      loanTermYears: state.loanTermYears,
      appreciationRate: state.propertyAppreciation,
      indexFundReturn: state.indexFundReturn,
      initialEquity: equity.equityFromSale,
      projectionYears: 20,
    });

    // 8. Amortization
    const amortization = Calc.amortizationSchedule(equity.loanNeeded, state.interestRate, state.loanTermYears);

    // 9. Upgrade comparison (stay vs buy)
    const upgrade = Calc.upgradeComparison({
      // Stay scenario — same rate & term as buy for fair comparison
      apartmentValue: state.apartmentSalePrice,
      currentLoan: state.currentLoan,
      currentRate: state.interestRate,
      currentTermYears: state.loanTermYears,
      currentFellesutgifter: state.currentFellesutgifter,
      currentInsurance: state.currentInsurance,
      currentOther: state.currentOther,
      aptAppreciation: state.apartmentAppreciation,
      savings: state.savings,
      indexFundReturn: state.indexFundReturn,
      // Buy scenario
      housePrice: state.housePurchasePrice,
      newLoan: equity.loanNeeded,
      newRate: state.interestRate,
      newTermYears: state.loanTermYears,
      newKommunale: state.newKommunale,
      newInsurance: state.newInsurance,
      newMaintenance: state.newMaintenance,
      newOther: state.newOther,
      houseAppreciation: state.propertyAppreciation,
      monthlyRentalIncome: state.monthlyRentalIncome,
      rentalGrowth: 2,
      projectionYears: 20,
    });

    // --- Render dashboard ---
    renderDashboard(equity, afford, tax, rentalTax);
    renderScenarioDetails(equity, afford, tax);
    renderSensitivityTable(sensitivity);
    renderRenovationTable(renovation);
    renderCostDetails(costs, tax, rentalTax);
    renderCashFlowDetails(tax, afford, rentalTax, costs);
    renderUpgradeComparison(upgrade);

    // --- Render charts ---
    Charts.renderRateSensitivity('chart-sensitivity', sensitivity);
    Charts.renderRenovationTimeline('chart-renovation', renovation, state.renovationAmount);
    Charts.renderNetWorth('chart-networth', netWorth);
    Charts.renderCostComparison('chart-costs', costs);
    Charts.renderAmortization('chart-amortization', amortization);
    Charts.renderPriceHistory('chart-pricehistory', OSLO_PRICE_HISTORY);
    Charts.renderUpgradeComparison('chart-upgrade', upgrade);
    const sifoForChart = SIFO[state.householdType].total;
    const elecForChart = state.monthlyElectricity;
    const netForChart = Math.round(tax.totalNet / 12);
    const studentLoanForChart = state.studentLoan > 0
      ? Calc.annuity(state.studentLoan, state.studentLoanRate, state.studentLoanTermYears).monthly : 0;
    Charts.renderCashFlow('chart-cashflow', {
      grossIncome: Math.round(state.grossIncome / 12),
      tax: Math.round(tax.totalTax / 12),
      netIncome: netForChart,
      housingCosts: costs.new.total,
      rentalIncome: state.monthlyRentalIncome,
      studentLoan: studentLoanForChart,
      sifoCosts: sifoForChart,
      electricity: elecForChart,
      remaining: netForChart - costs.new.total + state.monthlyRentalIncome - sifoForChart - elecForChart - studentLoanForChart,
    });
  }

  // ---------------------------------------------------------------------------
  // Render functions
  // ---------------------------------------------------------------------------
  function renderDashboard(eq, af, tax, rentalTax) {
    // Equity card
    setHtml('dash-equity-value', 'kr ' + NOK(eq.totalEquity));
    const savingsNote = eq.savings > 0 ? ` (bolig: ${NOK(eq.equityFromSale)} + sparing: ${NOK(eq.savings)})` : '';
    setHtml('dash-equity-sub', PCT(eq.equityPct) + ' av kjøpesum (krav: 10%)' + savingsNote);
    setClass('dash-equity-badge', eq.equityMet ? 'badge-pass' : 'badge-fail');
    setHtml('dash-equity-badge', eq.equityMet ? 'Oppfylt' : 'Ikke oppfylt');

    // Loan needed card
    setHtml('dash-loan-value', 'kr ' + NOK(eq.loanNeeded));
    const debtNote = eq.otherDebt > 0
      ? `Boliglån: ${NOK(eq.loanNeeded)} + Studielån: ${NOK(eq.otherDebt)} = Total gjeld: ${NOK(eq.totalDebt)}`
      : 'Total kjøpskostnad: kr ' + NOK(eq.totalPurchaseCost);
    setHtml('dash-loan-sub', debtNote);

    // 5x income card — now shows total debt vs max
    setHtml('dash-5x-value', 'kr ' + NOK(eq.maxTotalDebt5x));
    const gapText = eq.gap >= 0
      ? 'Margin: kr ' + NOK(eq.gap)
      : 'Mangler: kr ' + NOK(Math.abs(eq.gap));
    const debtBreakdown = eq.otherDebt > 0
      ? `Total gjeld: ${NOK(eq.totalDebt)} (${eq.debtToIncome}x) | ${gapText}`
      : `Gjeldsgrad: ${eq.debtToIncome}x | ${gapText}`;
    setHtml('dash-5x-sub', debtBreakdown);
    if (eq.effectiveIncome > state.grossIncome) {
      setHtml('dash-5x-rental', `Inkl. leieinntekt (${Math.round(state.rentalIncomeWeight*100)}%): kr ${NOK(eq.effectiveIncome)}`);
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
    const sifo = SIFO[state.householdType];
    const monthlyNet = Math.round(tax.totalNet / 12);
    const stressPayment = af.monthlyPaymentStress;
    const otherHousing = state.newKommunale + state.newInsurance + state.newMaintenance + state.newOther;
    const rentalOffset = state.monthlyRentalIncome;
    const dashStudentLoan = state.studentLoan > 0
      ? Calc.annuity(state.studentLoan, state.studentLoanRate, state.studentLoanTermYears).monthly : 0;
    const bankRemaining = monthlyNet - stressPayment - otherHousing + rentalOffset - sifo.total - state.monthlyElectricity - dashStudentLoan;
    setHtml('dash-sifo-value', 'kr ' + NOK(bankRemaining) + '/mnd');
    const sifoSubParts = [`SIFO: ${NOK(sifo.total)}`];
    if (dashStudentLoan > 0) sifoSubParts.push(`studielån: ${NOK(dashStudentLoan)}`);
    sifoSubParts.push(`strøm: ${NOK(state.monthlyElectricity)}`);
    setHtml('dash-sifo-sub', sifoSubParts.join(' + '));
    setClass('dash-sifo-badge', bankRemaining >= 0 ? 'badge-pass' : 'badge-fail');
    setHtml('dash-sifo-badge', bankRemaining >= 0 ? 'Likviditet OK' : 'Ikke nok til overs');
  }

  function renderScenarioDetails(eq, af, tax) {
    const tx = eq.transactionCosts;
    setHtml('detail-selling-costs', `
      <tr><td>Meglerkostnad</td><td class="number">kr ${NOK(tx.sellingCosts.realtorFee)}</td></tr>
      <tr><td><strong>Sum salgskostnader</strong></td><td class="number"><strong>kr ${NOK(tx.sellingCosts.total)}</strong></td></tr>
    `);
    setHtml('detail-buying-costs', `
      <tr><td>Dokumentavgift (2,5%)</td><td class="number">kr ${NOK(tx.buyingCosts.dokumentavgift)}</td></tr>
      <tr><td>Tinglysning</td><td class="number">kr ${NOK(tx.buyingCosts.tinglysning)}</td></tr>
      <tr><td>Bankgebyr</td><td class="number">kr ${NOK(tx.buyingCosts.bankFee)}</td></tr>
      <tr><td><strong>Sum kjøpskostnader</strong></td><td class="number"><strong>kr ${NOK(tx.buyingCosts.total)}</strong></td></tr>
    `);
    setHtml('detail-summary', `
      <tr><td>Salgssum leilighet</td><td class="number">kr ${NOK(state.apartmentSalePrice)}</td></tr>
      <tr><td>- Gjenstående lån</td><td class="number">kr ${NOK(state.currentLoan)}</td></tr>
      <tr><td>- Salgskostnader</td><td class="number">kr ${NOK(tx.sellingCosts.total)}</td></tr>
      <tr><td>= Egenkapital fra boligsalg</td><td class="number">kr ${NOK(eq.equityFromSale)}</td></tr>
      ${eq.savings > 0 ? `<tr><td>+ Sparepenger/fond/aksjer</td><td class="number">kr ${NOK(eq.savings)}</td></tr>` : ''}
      <tr class="highlight"><td><strong>= Total egenkapital</strong></td><td class="number"><strong>kr ${NOK(eq.totalEquity)}</strong></td></tr>
      <tr><td>&nbsp;</td><td></td></tr>
      <tr><td>Kjøpesum hus</td><td class="number">kr ${NOK(state.housePurchasePrice)}</td></tr>
      <tr><td>+ Kjøpskostnader</td><td class="number">kr ${NOK(tx.buyingCosts.total)}</td></tr>
      <tr><td><strong>= Totalt behov</strong></td><td class="number"><strong>kr ${NOK(eq.totalPurchaseCost)}</strong></td></tr>
      <tr><td>&nbsp;</td><td></td></tr>
      <tr class="${eq.gap >= 0 ? 'feasible-row' : 'stress-row'}">
        <td><strong>Boliglån behov</strong></td><td class="number"><strong>kr ${NOK(eq.loanNeeded)}</strong></td></tr>
      ${eq.otherDebt > 0 ? `
      <tr><td>&nbsp;</td><td></td></tr>
      <tr style="background:#f0f9ff"><td colspan="2"><strong>Gjeldsgrad (5x-regel)</strong></td></tr>
      <tr><td>Boliglån</td><td class="number">kr ${NOK(eq.loanNeeded)}</td></tr>
      <tr><td>+ Studielån</td><td class="number">kr ${NOK(eq.otherDebt)}</td></tr>
      <tr class="highlight"><td><strong>= Total gjeld</strong></td><td class="number"><strong>kr ${NOK(eq.totalDebt)}</strong></td></tr>
      <tr><td>Maks total gjeld (5x)</td><td class="number">kr ${NOK(eq.maxTotalDebt5x)}</td></tr>
      <tr><td>Maks boliglån (5x − studielån)</td><td class="number">kr ${NOK(eq.maxMortgage5x)}</td></tr>
      ` : `
      <tr><td>Maks lån (5x inntekt)</td><td class="number">kr ${NOK(eq.maxTotalDebt5x)}</td></tr>
      `}
      <tr class="${eq.gap >= 0 ? 'feasible-row' : 'stress-row'}">
        <td><strong>${eq.gap >= 0 ? 'Margin' : 'Gap (trenger unntak)'}</strong></td>
        <td class="number"><strong>kr ${NOK(Math.abs(eq.gap))}</strong></td></tr>
    `);
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

  function renderRenovationTable(data) {
    let rows = '';
    data.years.forEach((y) => {
      const cls = y.year === data.feasibleYear ? 'feasible-row' : '';
      rows += `<tr class="${cls}">
        <td>${y.year}</td>
        <td class="number">kr ${NOK(y.propertyValue)}</td>
        <td class="number">kr ${NOK(y.remainingLoan)}</td>
        <td class="number">kr ${NOK(y.grossIncome)}${y.rentalIncome > 0 ? ` (+${NOK(y.rentalIncome)})` : ''}</td>
        <td class="number">kr ${NOK(y.canBorrowByEquity)}</td>
        <td class="number">kr ${NOK(y.canBorrowByIncome)}</td>
        <td class="number">${y.renovationFeasible ? 'Ja' : 'Nei'}</td>
      </tr>`;
    });
    setHtml('renovation-table-body', rows);
    const fy = data.feasibleYear;
    setHtml('renovation-verdict', fy !== null
      ? `Renovering mulig fra år ${fy} (${2026 + fy})`
      : 'Renovering ikke mulig innen 15 år med disse forutsetningene');
  }

  function renderCostDetails(costs, tax, rentalTax) {
    setHtml('cost-current-total', 'kr ' + NOK(costs.current.total) + '/mnd');
    setHtml('cost-new-total', 'kr ' + NOK(costs.new.total) + '/mnd');
    const diff = costs.difference;
    setHtml('cost-difference', (diff >= 0 ? '+' : '') + 'kr ' + NOK(diff) + '/mnd');
    setClass('cost-difference', diff > 0 ? 'ratio-bad' : 'ratio-good');

    if (state.monthlyRentalIncome > 0) {
      setHtml('rental-info', `
        Leieinntekt: kr ${NOK(state.monthlyRentalIncome)}/mnd (kr ${NOK(state.monthlyRentalIncome * 12)}/år)
        ${rentalTax.taxFree ? '— Skattefritt (du bruker >50% selv)' : `— Skatt: kr ${NOK(rentalTax.tax)}/år`}
      `);
    } else {
      setHtml('rental-info', '');
    }
  }

  function renderCashFlowDetails(tax, afford, rentalTax, costs) {
    const monthlyNet = Math.round(tax.totalNet / 12);
    const monthlyRental = state.monthlyRentalIncome;
    const housingCost = costs.new.total;
    const sifo = SIFO[state.householdType];
    const sifoTotal = sifo.total;
    const electricity = state.monthlyElectricity;

    // Student loan monthly payment
    const studentLoanMonthly = state.studentLoan > 0
      ? Calc.annuity(state.studentLoan, state.studentLoanRate, state.studentLoanTermYears).monthly
      : 0;

    const remaining = monthlyNet - housingCost + monthlyRental - sifoTotal - electricity - studentLoanMonthly;

    // Bank's stress test view
    const stressRate = Math.max(state.interestRate + 3, 7);
    const stressMonthly = afford.monthlyPaymentStress;
    const bankHousingStress = stressMonthly + state.newKommunale + state.newInsurance + state.newMaintenance + state.newOther - monthlyRental;
    const bankTotal = bankHousingStress + studentLoanMonthly + sifoTotal + electricity;
    const bankRemaining = monthlyNet - bankTotal;
    const bankPasses = bankRemaining >= 0;

    setHtml('cashflow-details', `
      <tr><td>Brutto inntekt</td><td class="number">kr ${NOK(Math.round(state.grossIncome / 12))}/mnd</td></tr>
      <tr><td>- Skatt (effektiv ${PCT(tax.effectiveRate)})</td><td class="number">kr ${NOK(Math.round(tax.totalTax / 12))}/mnd</td></tr>
      <tr class="highlight"><td><strong>Netto inntekt</strong></td><td class="number"><strong>kr ${NOK(monthlyNet)}/mnd</strong></td></tr>
      <tr><td>- Boutgifter ny bolig</td><td class="number">kr ${NOK(housingCost)}/mnd</td></tr>
      ${studentLoanMonthly > 0 ? `<tr><td>- Studielån (${state.studentLoanRate}%, ${state.studentLoanTermYears} år)</td><td class="number">kr ${NOK(studentLoanMonthly)}/mnd</td></tr>` : ''}
      ${monthlyRental > 0 ? `<tr><td>+ Leieinntekt</td><td class="number">kr ${NOK(monthlyRental)}/mnd</td></tr>` : ''}
      <tr><td>- SIFO levekostnader (${sifo.label})</td><td class="number">kr ${NOK(sifoTotal)}/mnd</td></tr>
      <tr><td>- Strøm</td><td class="number">kr ${NOK(electricity)}/mnd</td></tr>
      <tr class="${remaining > 0 ? 'feasible-row' : 'stress-row'}">
        <td><strong>Til overs</strong></td><td class="number"><strong>kr ${NOK(remaining)}/mnd</strong></td></tr>
    `);

    // Bank's perspective (stress test rate)
    setHtml('bank-perspective', `
      <table class="data-table">
        <tr><td>Netto inntekt</td><td class="number">kr ${NOK(monthlyNet)}/mnd</td></tr>
        <tr><td>- Boliglån ved stresstest (${stressRate.toFixed(1)}%)</td><td class="number">kr ${NOK(stressMonthly)}/mnd</td></tr>
        ${studentLoanMonthly > 0 ? `<tr><td>- Studielån (${NOK(state.studentLoan)}, ${state.studentLoanRate}%)</td><td class="number">kr ${NOK(studentLoanMonthly)}/mnd</td></tr>` : ''}
        <tr><td>- Andre boutgifter</td><td class="number">kr ${NOK(state.newKommunale + state.newInsurance + state.newMaintenance + state.newOther)}/mnd</td></tr>
        ${monthlyRental > 0 ? `<tr><td>+ Leieinntekt</td><td class="number">kr ${NOK(monthlyRental)}/mnd</td></tr>` : ''}
        <tr><td>- SIFO levekostnader (${sifo.label})</td><td class="number">kr ${NOK(sifoTotal)}/mnd</td></tr>
        <tr><td>- Strøm</td><td class="number">kr ${NOK(electricity)}/mnd</td></tr>
        <tr class="${bankPasses ? 'feasible-row' : 'stress-row'}">
          <td><strong>Likviditetsoverskudd</strong></td>
          <td class="number"><strong>kr ${NOK(bankRemaining)}/mnd</strong></td>
        </tr>
      </table>
    `);
    setHtml('bank-verdict', bankPasses ? 'Banken: Bestått' : 'Banken: Ikke bestått');
    setClass('bank-verdict', bankPasses ? 'badge-pass' : 'badge-fail');

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
        <tr class="highlight"><td><strong>Sum SIFO</strong></td><td class="number"><strong>kr ${NOK(sifoTotal)}</strong></td></tr>
      </table>
    `);

    setHtml('tax-breakdown', `
      Person 1 (${Math.round(state.incomeSplit*100)}%): Brutto kr ${NOK(tax.person1.gross)} → Netto kr ${NOK(tax.person1.net)} (${PCT(tax.person1.effectiveRate)} skatt)<br>
      Person 2 (${Math.round((1-state.incomeSplit)*100)}%): Brutto kr ${NOK(tax.person2.gross)} → Netto kr ${NOK(tax.person2.net)} (${PCT(tax.person2.effectiveRate)} skatt)
    `);
  }

  function renderUpgradeComparison(data) {
    // Verdict
    const be = data.breakEvenYear;
    setHtml('upgrade-verdict', be !== null
      ? `Huskjøp lønner seg fra år ${be} (${2026 + be})`
      : 'Å bli boende er mer lønnsomt i hele perioden');
    if (be !== null) {
      setClass('upgrade-verdict', 'badge-pass');
    }

    // Leverage & tax summary
    const s = data.summary;
    const y0 = data.years[0];
    setHtml('upgrade-leverage', `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
        <div>
          <div class="text-2xl font-bold text-blue-600">${y0.buyLeverage}x</div>
          <div class="text-xs text-slate-500">Giring huskjøp</div>
          <div class="text-xs text-slate-400">EK → full eksponering</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-indigo-600">${y0.stayLeverage}x</div>
          <div class="text-xs text-slate-500">Giring leilighet</div>
          <div class="text-xs text-slate-400">Nåværende belåning</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-green-600">kr ${NOK(s.totalRentefradragAdvantage)}</div>
          <div class="text-xs text-slate-500">Ekstra rentefradrag (kjøp)</div>
          <div class="text-xs text-slate-400">Over ${data.years.length - 1} år, 22% av renter</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-red-600">kr ${NOK(s.totalFundTaxPaid)}</div>
          <div class="text-xs text-slate-500">Skatt på fondsgevinst</div>
          <div class="text-xs text-slate-400">37,84% (22% × 1,72)</div>
        </div>
      </div>
    `);

    // Summary cards
    const y5 = data.years[5] || data.years[data.years.length - 1];
    const y10 = data.years[10] || data.years[data.years.length - 1];
    const y20 = data.years[20] || data.years[data.years.length - 1];

    const renderYearCard = (y, label) => `
      <div class="text-xs text-slate-500">${label}</div>
      <div class="text-xl font-bold ${y.netWorthDiff >= 0 ? 'text-green-600' : 'text-red-600'}">${y.netWorthDiff >= 0 ? '+' : ''}${NOK(y.netWorthDiff)}</div>
      <div class="text-xs text-slate-400">Formuesforskjell (etter skatt)</div>
      <div class="text-xs mt-1">Mndkost: ${y.monthlyCostDiff >= 0 ? '+' : ''}${NOK(y.monthlyCostDiff)}/mnd</div>
      <div class="text-xs text-slate-400 mt-1">Avk. på EK: hus ${y.buyReturnOnEquity}% vs leil. ${y.stayReturnOnEquity}%</div>
      <div class="text-xs text-slate-400">Rentefradrag: +${NOK(y.rentefradragDiff)} mer ved kjøp</div>
    `;
    setHtml('upgrade-5yr', renderYearCard(y5, 'Etter 5 år'));
    setHtml('upgrade-10yr', renderYearCard(y10, 'Etter 10 år'));
    setHtml('upgrade-20yr', renderYearCard(y20, 'Etter 20 år'));

    // Table
    let rows = '';
    data.years.forEach((y) => {
      if (y.year > 20) return;
      const cls = y.year === data.breakEvenYear ? 'feasible-row' : '';
      rows += `<tr class="${cls}">
        <td>${y.year}</td>
        <td class="number">kr ${NOK(y.aptValue)}<br><span class="text-xs text-slate-400">lån: ${NOK(y.aptLoan)}</span></td>
        <td class="number">kr ${NOK(y.savingsAfterTax)}<br><span class="text-xs text-slate-400">skatt: -${NOK(y.savingsTaxOnGain)}</span></td>
        <td class="number font-semibold">kr ${NOK(y.stayNetWorth)}</td>
        <td class="number">kr ${NOK(y.houseValue)}<br><span class="text-xs text-slate-400">lån: ${NOK(y.houseLoan)}</span></td>
        <td class="number font-semibold">kr ${NOK(y.buyNetWorth)}</td>
        <td class="number ${y.netWorthDiff >= 0 ? 'ratio-good' : 'ratio-bad'} font-bold">${y.netWorthDiff >= 0 ? '+' : ''}${NOK(y.netWorthDiff)}</td>
        <td class="number">${NOK(y.buyRentefradrag - y.stayRentefradrag)}/år</td>
      </tr>`;
    });
    setHtml('upgrade-table-body', rows);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
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
        const avg5yr = ((last5[last5.length-1].index / last5[0].index) ** (1/5) - 1) * 100;
        const allChanges = OSLO_PRICE_HISTORY.filter(d => d.change !== 0);
        const worst = allChanges.reduce((a, b) => a.change < b.change ? a : b);
        const best = allChanges.reduce((a, b) => a.change > b.change ? a : b);
        const avgAll = ((OSLO_PRICE_HISTORY[len-1].index / OSLO_PRICE_HISTORY[0].index) ** (1/(len-1)) - 1) * 100;
        setHtml('stat-avg-all', '~' + avgAll.toFixed(1) + '%');
        setHtml('stat-avg-5yr', '~' + avg5yr.toFixed(1) + '%');
        setHtml('stat-worst', worst.change.toFixed(1) + '% (' + worst.year + ')');
        setHtml('stat-best', '+' + best.change.toFixed(1) + '% (' + best.year + ')');
      }
    }
  });
})();
