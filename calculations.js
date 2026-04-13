// =============================================================================
// Boligkalkulator Oslo — Pure Calculation Engine
// All financial calculations, no DOM access
// =============================================================================

window.Calc = (function () {
  // ---------------------------------------------------------------------------
  // Constants — Norwegian tax 2026
  // ---------------------------------------------------------------------------
  const TAX = {
    alminneligSats: 0.22,
    trygdeavgift: 0.077,
    personfradrag: 114540,
    minstefradragSats: 0.46,
    minstefradragMax: 95700,
    trinnskatt: [
      { from: 0, to: 226100, rate: 0 },
      { from: 226100, to: 318300, rate: 0.017 },
      { from: 318300, to: 725050, rate: 0.04 },
      { from: 725050, to: 980100, rate: 0.137 },
      { from: 980100, to: 1467200, rate: 0.168 },
      { from: 1467200, to: Infinity, rate: 0.178 },
    ],
  };

  // ---------------------------------------------------------------------------
  // Tax calculator (individual)
  // ---------------------------------------------------------------------------
  function calculateTaxIndividual(gross) {
    if (gross <= 0) return { gross: 0, tax: 0, net: 0, effectiveRate: 0, breakdown: {} };

    const minstefradrag = Math.min(gross * TAX.minstefradragSats, TAX.minstefradragMax);
    const alminneligInntekt = Math.max(0, gross - minstefradrag - TAX.personfradrag);
    const ordinaryTax = alminneligInntekt * TAX.alminneligSats;
    const trygdeavgift = gross * TAX.trygdeavgift;

    let trinnskatt = 0;
    for (const bracket of TAX.trinnskatt) {
      if (gross > bracket.from) {
        const taxable = Math.min(gross, bracket.to) - bracket.from;
        trinnskatt += taxable * bracket.rate;
      }
    }

    const totalTax = ordinaryTax + trygdeavgift + trinnskatt;
    return {
      gross,
      tax: Math.round(totalTax),
      net: Math.round(gross - totalTax),
      effectiveRate: totalTax / gross,
      breakdown: {
        ordinaryTax: Math.round(ordinaryTax),
        trygdeavgift: Math.round(trygdeavgift),
        trinnskatt: Math.round(trinnskatt),
      },
    };
  }

  function calculateHouseholdTax(totalGross, splitRatio) {
    const income1 = totalGross * splitRatio;
    const income2 = totalGross * (1 - splitRatio);
    const tax1 = calculateTaxIndividual(income1);
    const tax2 = calculateTaxIndividual(income2);
    return {
      totalGross,
      totalTax: tax1.tax + tax2.tax,
      totalNet: tax1.net + tax2.net,
      effectiveRate: (tax1.tax + tax2.tax) / totalGross,
      person1: tax1,
      person2: tax2,
    };
  }

  // ---------------------------------------------------------------------------
  // Rental income tax (utleie i egen bolig — tax-free if you use >= 50%)
  // ---------------------------------------------------------------------------
  function calculateRentalIncomeTax(annualRental, ownerOccupiedShare) {
    // If owner uses >= 50% of the property, rental income is tax-free
    if (ownerOccupiedShare >= 0.5) {
      return { gross: annualRental, tax: 0, net: annualRental, taxFree: true };
    }
    // Otherwise taxed as capital income at 22%
    const tax = annualRental * 0.22;
    return { gross: annualRental, tax: Math.round(tax), net: Math.round(annualRental - tax), taxFree: false };
  }

  // ---------------------------------------------------------------------------
  // Transaction costs
  // ---------------------------------------------------------------------------
  function calculateTransactionCosts(salePrice, purchasePrice, realtorPct, realtorFixed) {
    const sellingCosts = {
      realtorFee: Math.round(salePrice * (realtorPct / 100) + realtorFixed),
      total: 0,
    };
    sellingCosts.total = sellingCosts.realtorFee;

    const buyingCosts = {
      dokumentavgift: Math.round(purchasePrice * 0.025),
      tinglysning: 1170, // skjøte + pantedokument
      bankFee: 5000,
      total: 0,
    };
    buyingCosts.total = buyingCosts.dokumentavgift + buyingCosts.tinglysning + buyingCosts.bankFee;

    return {
      sellingCosts,
      buyingCosts,
      totalCosts: sellingCosts.total + buyingCosts.total,
    };
  }

  // ---------------------------------------------------------------------------
  // Equity & loan analysis
  // ---------------------------------------------------------------------------
  function calculateEquityPosition(p) {
    const tx = calculateTransactionCosts(p.apartmentSalePrice, p.housePurchasePrice, p.realtorPct, p.realtorFixed);

    const equityFromSale = p.apartmentSalePrice - p.currentLoan - tx.sellingCosts.total;
    const savings = p.savings || 0; // sparepenger, BSU, aksjer, fond
    const totalEquity = equityFromSale + savings;
    const totalPurchaseCost = p.housePurchasePrice + tx.buyingCosts.total;
    const loanNeeded = Math.max(0, totalPurchaseCost - totalEquity);

    const requiredEquityPct = 0.10; // 10% since Dec 2024
    const requiredEquity = p.housePurchasePrice * requiredEquityPct;
    const equityMet = totalEquity >= requiredEquity;

    // Effective income for 5x rule — banks may count 60-80% of documented rental income
    const rentalForLoan = (p.annualRentalIncome || 0) * (p.rentalIncomeWeight || 0.6);
    const effectiveIncome = p.grossIncome + rentalForLoan;

    // 5x rule applies to TOTAL debt (mortgage + student loan + any other debt)
    const otherDebt = p.otherDebt || 0;
    const totalDebt = loanNeeded + otherDebt;
    const maxTotalDebt5x = effectiveIncome * 5;
    const maxMortgage5x = maxTotalDebt5x - otherDebt; // room for mortgage after other debt
    const incomeRuleMet = totalDebt <= maxTotalDebt5x;
    const gap = maxMortgage5x - loanNeeded; // gap is how much room you have for the mortgage

    const debtToIncome = totalDebt / effectiveIncome;

    return {
      equityFromSale: Math.round(equityFromSale),
      savings: Math.round(savings),
      totalEquity: Math.round(totalEquity),
      requiredEquity: Math.round(requiredEquity),
      equityMet,
      equityPct: totalEquity / p.housePurchasePrice,
      loanNeeded: Math.round(loanNeeded),
      otherDebt: Math.round(otherDebt),
      totalDebt: Math.round(totalDebt),
      maxTotalDebt5x: Math.round(maxTotalDebt5x),
      maxMortgage5x: Math.round(maxMortgage5x),
      effectiveIncome: Math.round(effectiveIncome),
      incomeRuleMet,
      gap: Math.round(gap),
      debtToIncome: Math.round(debtToIncome * 100) / 100,
      totalPurchaseCost: Math.round(totalPurchaseCost),
      transactionCosts: tx,
    };
  }

  // ---------------------------------------------------------------------------
  // Upgrade comparison: Stay in apartment vs Buy house
  //
  // Key Norwegian tax rules modelled:
  // 1. Rentefradrag: 22% tax deduction on all mortgage interest
  // 2. Boligsalg: Tax-free if lived there 1 of last 2 years (primary residence)
  // 3. Aksjegevinst: Taxed at 22% × oppjusteringsfaktor 1.72 = 37.84% effective
  // 4. Giring/leverage: Property appreciation applies to full value, not just equity
  // ---------------------------------------------------------------------------
  const RENTEFRADRAG_RATE = 0.22;          // 22% tax deduction on interest
  const FUND_GAIN_TAX_RATE = 0.22 * 1.72;  // 37.84% effective (aksjonærmodellen)

  function upgradeComparison(p) {
    const years = [];
    const staySchedule = amortizationSchedule(p.currentLoan, p.currentRate, p.currentTermYears);
    const buySchedule = amortizationSchedule(p.newLoan, p.newRate, p.newTermYears);

    // Track cumulative interest for rentefradrag comparison
    let stayCumulativeInterest = 0;
    let buyCumulativeInterest = 0;
    let stayCumulativeRentefradrag = 0;
    let buyCumulativeRentefradrag = 0;

    for (let y = 0; y <= p.projectionYears; y++) {
      // === STAY scenario ===
      const aptValue = Math.round(p.apartmentValue * Math.pow(1 + p.aptAppreciation / 100, y));
      const aptLoan = y === 0 ? p.currentLoan : (staySchedule[y - 1] ? staySchedule[y - 1].remainingBalance : 0);
      const stayYearData = y > 0 && y <= staySchedule.length ? staySchedule[y - 1] : null;
      const stayInterest = stayYearData ? stayYearData.interest : 0;
      const stayRentefradrag = Math.round(stayInterest * RENTEFRADRAG_RATE);
      stayCumulativeInterest += stayInterest;
      stayCumulativeRentefradrag += stayRentefradrag;

      const stayMortgageMonthly = stayYearData ? Math.round(stayYearData.annualPayment / 12) : 0;
      // Effective housing cost after rentefradrag
      const stayHousingMonthly = stayMortgageMonthly + p.currentFellesutgifter + p.currentInsurance + p.currentOther - Math.round(stayRentefradrag / 12);

      // Savings: grow with index fund returns (pre-tax)
      const savingsGross = Math.round(p.savings * Math.pow(1 + p.indexFundReturn / 100, y));
      const savingsGain = savingsGross - p.savings;
      // After-tax value if sold: gains taxed at 37.84%
      const savingsTaxOnGain = Math.max(0, Math.round(savingsGain * FUND_GAIN_TAX_RATE));
      const savingsAfterTax = savingsGross - savingsTaxOnGain;

      // Apartment sale is TAX FREE (primary residence, bodd > 1 av 2 år)
      const aptGain = aptValue - p.apartmentValue; // unrealized, tax-free
      const stayNetWorth = aptValue - aptLoan + savingsAfterTax;

      // Leverage metrics for stay
      const stayEquityInvested = p.apartmentValue - p.currentLoan; // initial equity
      const stayReturnOnEquity = stayEquityInvested > 0 ? (aptGain / stayEquityInvested) : 0;

      // === BUY scenario ===
      const houseValue = Math.round(p.housePrice * Math.pow(1 + p.houseAppreciation / 100, y));
      const houseLoan = y === 0 ? p.newLoan : (buySchedule[y - 1] ? buySchedule[y - 1].remainingBalance : 0);
      const buyYearData = y > 0 && y <= buySchedule.length ? buySchedule[y - 1] : null;
      const buyInterest = buyYearData ? buyYearData.interest : 0;
      const buyRentefradrag = Math.round(buyInterest * RENTEFRADRAG_RATE);
      buyCumulativeInterest += buyInterest;
      buyCumulativeRentefradrag += buyRentefradrag;

      const buyMortgageMonthly = buyYearData ? Math.round(buyYearData.annualPayment / 12) : 0;
      const rentalMonthly = Math.round((p.monthlyRentalIncome || 0) * Math.pow(1 + (p.rentalGrowth || 2) / 100, y));
      // Effective housing cost after rentefradrag
      const buyHousingMonthly = buyMortgageMonthly + p.newKommunale + p.newInsurance + p.newMaintenance + p.newOther - rentalMonthly - Math.round(buyRentefradrag / 12);

      // House sale is TAX FREE (primary residence)
      const houseGain = houseValue - p.housePrice;
      const buyNetWorth = houseValue - houseLoan; // no tax on sale

      // Leverage: appreciation on full house value, but only equity invested
      const buyEquityInvested = p.housePrice - p.newLoan; // initial equity put in
      const buyReturnOnEquity = buyEquityInvested > 0 ? (houseGain / buyEquityInvested) : 0;
      // Leverage ratio
      const buyLeverage = buyEquityInvested > 0 ? (p.housePrice / buyEquityInvested) : 0;
      const stayLeverage = stayEquityInvested > 0 ? (p.apartmentValue / stayEquityInvested) : 0;

      // Monthly cost difference (positive = buying is more expensive)
      const monthlyCostDiff = buyHousingMonthly - stayHousingMonthly;
      const cumulativeExtraCost = y === 0 ? 0 : (years[y - 1].cumulativeExtraCost + monthlyCostDiff * 12);

      years.push({
        year: y,
        // Stay
        aptValue,
        aptLoan,
        savingsGross,
        savingsTaxOnGain,
        savingsAfterTax,
        stayNetWorth,
        stayMonthly: Math.round(stayHousingMonthly),
        stayRentefradrag,
        stayLeverage: Math.round(stayLeverage * 10) / 10,
        stayReturnOnEquity: Math.round(stayReturnOnEquity * 1000) / 10,
        // Buy
        houseValue,
        houseLoan,
        buyNetWorth,
        buyMonthly: Math.round(buyHousingMonthly),
        buyRentefradrag,
        buyLeverage: Math.round(buyLeverage * 10) / 10,
        buyReturnOnEquity: Math.round(buyReturnOnEquity * 1000) / 10,
        rentalIncome: rentalMonthly,
        // Comparison
        netWorthDiff: buyNetWorth - stayNetWorth,
        monthlyCostDiff: Math.round(monthlyCostDiff),
        cumulativeExtraCost: Math.round(cumulativeExtraCost),
        // Cumulative tax benefits
        stayCumRentefradrag: stayCumulativeRentefradrag,
        buyCumRentefradrag: buyCumulativeRentefradrag,
        rentefradragDiff: buyCumulativeRentefradrag - stayCumulativeRentefradrag,
      });
    }

    const breakEvenYear = years.find((y) => y.year > 0 && y.netWorthDiff >= 0);

    // Summary: total tax advantage of buying
    const lastYear = years[years.length - 1];
    const totalRentefradragAdvantage = lastYear.rentefradragDiff;
    const totalFundTaxPaid = lastYear.savingsTaxOnGain;

    return {
      years,
      breakEvenYear: breakEvenYear ? breakEvenYear.year : null,
      summary: {
        totalRentefradragAdvantage,
        totalFundTaxPaid,
        buyLeverage: years[0].buyLeverage,
        stayLeverage: years[0].stayLeverage,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Annuity
  // ---------------------------------------------------------------------------
  function annuity(principal, annualRate, termYears) {
    const r = annualRate / 100 / 12;
    const n = termYears * 12;
    if (r === 0) return { monthly: principal / n, total: principal, totalInterest: 0 };
    const monthly = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    return {
      monthly: Math.round(monthly),
      total: Math.round(monthly * n),
      totalInterest: Math.round(monthly * n - principal),
    };
  }

  function amortizationSchedule(principal, annualRate, termYears) {
    const r = annualRate / 100 / 12;
    const n = termYears * 12;
    const monthlyPayment = r === 0 ? principal / n : (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

    let balance = principal;
    const years = [];
    let yearInterest = 0;
    let yearPrincipal = 0;

    for (let m = 1; m <= n; m++) {
      const interest = balance * r;
      const princ = monthlyPayment - interest;
      balance -= princ;
      yearInterest += interest;
      yearPrincipal += princ;

      if (m % 12 === 0) {
        years.push({
          year: m / 12,
          interest: Math.round(yearInterest),
          principal: Math.round(yearPrincipal),
          remainingBalance: Math.max(0, Math.round(balance)),
          annualPayment: Math.round(yearInterest + yearPrincipal),
        });
        yearInterest = 0;
        yearPrincipal = 0;
      }
    }
    return years;
  }

  // ---------------------------------------------------------------------------
  // Stress test & affordability
  // ---------------------------------------------------------------------------
  function calculateAffordability(loanAmount, interestRate, termYears, grossIncome, netIncome, rentalIncome) {
    const stressRate = Math.max(interestRate + 3, 7);
    const current = annuity(loanAmount, interestRate, termYears);
    const stress = annuity(loanAmount, stressRate, termYears);

    const annualCostCurrent = current.monthly * 12;
    const annualCostStress = stress.monthly * 12;
    const effectiveNetIncome = netIncome + (rentalIncome || 0); // rental from own home is tax-free

    return {
      monthlyPaymentCurrent: current.monthly,
      monthlyPaymentStress: stress.monthly,
      annualCostCurrent,
      annualCostStress,
      stressRate,
      debtServiceRatioGross: annualCostCurrent / grossIncome,
      debtServiceRatioStress: annualCostStress / grossIncome,
      housingCostRatioNet: (annualCostCurrent / 12) / (effectiveNetIncome / 12),
      passesStressTest: annualCostStress / grossIncome < 0.5,
    };
  }

  // ---------------------------------------------------------------------------
  // Rate sensitivity
  // ---------------------------------------------------------------------------
  function rateSensitivity(loanAmount, termYears, currentRate, grossIncome, netIncome, rentalIncome) {
    const offsets = [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0, 3.0];
    const effectiveNet = netIncome + (rentalIncome || 0);
    return offsets.map((offset) => {
      const rate = Math.max(0.5, currentRate + offset);
      const a = annuity(loanAmount, rate, termYears);
      const stressRate = Math.max(rate + 3, 7);
      return {
        rate: Math.round(rate * 10) / 10,
        offset,
        monthlyPayment: a.monthly,
        annualCost: a.monthly * 12,
        debtServiceRatioGross: (a.monthly * 12) / grossIncome,
        housingCostRatioNet: a.monthly / (effectiveNet / 12),
        isCurrentRate: offset === 0,
        isStressTest: offset === 3,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Renovation timeline
  // ---------------------------------------------------------------------------
  function renovationTimeline(p) {
    const schedule = amortizationSchedule(p.initialLoan, p.interestRate, p.loanTermYears);
    const years = [];

    for (let y = 0; y <= 15; y++) {
      const propertyValue = Math.round(p.initialPropertyValue * Math.pow(1 + p.appreciationRate / 100, y));
      const grossIncome = Math.round(p.grossIncome * Math.pow(1 + p.salaryGrowthRate / 100, y));
      const rentalIncome = Math.round((p.annualRentalIncome || 0) * Math.pow(1 + p.salaryGrowthRate / 100, y));
      const effectiveIncome = grossIncome + rentalIncome * (p.rentalIncomeWeight || 0.6);
      const remainingLoan = y === 0 ? p.initialLoan : (schedule[y - 1] ? schedule[y - 1].remainingBalance : 0);

      const maxLoan5x = effectiveIncome * 5;
      const availableEquity = propertyValue * 0.90 - remainingLoan; // 10% must stay as equity
      const canBorrowByEquity = Math.max(0, availableEquity);
      const canBorrowByIncome = Math.max(0, maxLoan5x - remainingLoan);
      const maxAdditional = Math.min(canBorrowByEquity, canBorrowByIncome);
      const renovationFeasible = maxAdditional >= p.renovationAmount;

      years.push({
        year: y,
        propertyValue,
        remainingLoan,
        grossIncome,
        rentalIncome,
        effectiveIncome: Math.round(effectiveIncome),
        maxLoan5x: Math.round(maxLoan5x),
        canBorrowByEquity: Math.round(canBorrowByEquity),
        canBorrowByIncome: Math.round(canBorrowByIncome),
        maxAdditional: Math.round(maxAdditional),
        renovationFeasible,
      });
    }

    const feasibleYear = years.find((y) => y.renovationFeasible);
    return { years, feasibleYear: feasibleYear ? feasibleYear.year : null };
  }

  // ---------------------------------------------------------------------------
  // Net worth trajectory
  // ---------------------------------------------------------------------------
  function netWorthTrajectory(p) {
    const schedule = amortizationSchedule(p.loan, p.interestRate, p.loanTermYears);
    const years = [];

    for (let y = 0; y <= p.projectionYears; y++) {
      const propertyValue = Math.round(p.propertyValue * Math.pow(1 + p.appreciationRate / 100, y));
      const remainingLoan = y === 0 ? p.loan : (schedule[y - 1] ? schedule[y - 1].remainingBalance : 0);
      const netWorthProperty = propertyValue - remainingLoan;

      // Alternative: invest the equity in index funds
      const investedEquity = p.initialEquity;
      const investmentValue = Math.round(investedEquity * Math.pow(1 + p.indexFundReturn / 100, y));

      years.push({
        year: y,
        propertyValue,
        remainingLoan,
        netWorthProperty,
        investmentValue,
      });
    }
    return years;
  }

  // ---------------------------------------------------------------------------
  // Monthly cost comparison
  // ---------------------------------------------------------------------------
  function monthlyCostComparison(p) {
    const currentMortgage = annuity(p.currentLoan, p.currentRate, p.currentTermYears).monthly;
    const newMortgage = annuity(p.newLoan, p.newRate, p.newTermYears).monthly;

    const currentTotal = currentMortgage + p.currentFellesutgifter + p.currentInsurance + p.currentOther;
    const rentalOffset = Math.round((p.monthlyRentalIncome || 0));
    const newTotal = newMortgage + p.newKommunale + p.newInsurance + p.newMaintenance + p.newOther - rentalOffset;

    return {
      current: {
        mortgage: currentMortgage,
        fellesutgifter: p.currentFellesutgifter,
        insurance: p.currentInsurance,
        other: p.currentOther,
        total: currentTotal,
      },
      new: {
        mortgage: newMortgage,
        kommunale: p.newKommunale,
        insurance: p.newInsurance,
        maintenance: p.newMaintenance,
        other: p.newOther,
        rentalIncome: rentalOffset,
        total: newTotal,
      },
      difference: newTotal - currentTotal,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    calculateTaxIndividual,
    calculateHouseholdTax,
    calculateRentalIncomeTax,
    calculateTransactionCosts,
    calculateEquityPosition,
    annuity,
    amortizationSchedule,
    calculateAffordability,
    rateSensitivity,
    renovationTimeline,
    netWorthTrajectory,
    monthlyCostComparison,
    upgradeComparison,
  };
})();
