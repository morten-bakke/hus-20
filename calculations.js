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
      tinglysning: 1090, // skjøte 545 + pantedokument 545
      boligkjoperforsikring: 17_900, // Tryg / Söderberg
      total: 0,
    };
    buyingCosts.total = buyingCosts.dokumentavgift + buyingCosts.tinglysning + buyingCosts.boligkjoperforsikring;

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
    const equityAvailable = equityFromSale + savings;
    const totalPurchaseCost = p.housePurchasePrice + tx.buyingCosts.total;
    const minLoan = Math.max(0, totalPurchaseCost - equityAvailable); // loan if ALL equity is used

    // desiredLoan lets you ask for more than the minimum (e.g. to avoid
    // touching savings beyond the apartment-sale equity) — defaults to minLoan.
    const loanNeeded = p.desiredLoan != null ? Math.round(p.desiredLoan) : minLoan;
    const equityUsed = totalPurchaseCost - loanNeeded; // equity actually required at this loan level
    const savingsUsed = Math.min(savings, Math.max(0, equityUsed - equityFromSale));
    const savingsUnused = savings - savingsUsed;
    const totalEquity = equityUsed;

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
      savingsUsed: Math.round(savingsUsed),
      savingsUnused: Math.round(savingsUnused),
      equityAvailable: Math.round(equityAvailable),
      minLoan: Math.round(minLoan),
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
  // Rental income sensitivity — shows the loan holds up even without the
  // expected rental income from the hybel, not just at the optimistic figure.
  // Isolates ONE variable (rental income) at today's actual rate — deliberately
  // NOT combined with the rate stress test, so the two risk scenarios don't blend.
  // ---------------------------------------------------------------------------
  function rentalIncomeSensitivity(p) {
    const expected = p.expectedMonthlyRental || 0;
    const fractions = expected > 0 ? [0, 0.25, 0.5, 0.75, 1] : [0];
    const levels = [...new Set(fractions.map((f) => Math.round((expected * f) / 500) * 500))].sort((a, b) => a - b);

    return levels.map((monthlyRental) => {
      const annualRental = monthlyRental * 12;
      const effectiveIncome = p.grossIncome + annualRental * (p.rentalIncomeWeight || 0);
      const otherDebt = p.otherDebt || 0;
      const totalDebt = p.loanNeeded + otherDebt;
      const maxTotalDebt5x = effectiveIncome * 5;
      const maxMortgage5x = maxTotalDebt5x - otherDebt;
      const gap = maxMortgage5x - p.loanNeeded;
      const incomeRuleMet = totalDebt <= maxTotalDebt5x;

      const housingCost = p.monthlyPayment + p.fixedHousingCosts - monthlyRental;
      const bankRemaining = p.netIncomeMonthly - housingCost - (p.studentLoanMonthly || 0) - p.sifoTotal - p.electricity;

      return {
        monthlyRental,
        isExpected: monthlyRental === expected,
        gap: Math.round(gap),
        incomeRuleMet,
        bankRemaining: Math.round(bankRemaining),
        passes: bankRemaining >= 0, // liquidity at this rental level — the question this analysis answers
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Resilience curve ("tåleevne") — bank/SIFO liquidity surplus as a continuous
  // function of the mortgage rate. The 3pp stress test is just one x-value on
  // this curve; the break-even rate (where the surplus hits zero) is how much
  // rate increase the household can actually absorb.
  //   surplus(r) = netIncome − annuity(loan, r) − studielån − SIFO − strøm
  //                − faste boutgifter + leieinntekt
  // ---------------------------------------------------------------------------
  function resilienceCurve(p) {
    const currentRate = p.currentRate;
    const stressRate = Math.max(currentRate + 3, 7);

    const fixedOutflow = (p.studentLoanMonthly || 0) + p.sifoMonthly + p.electricity
      + p.fixedHousingCosts - (p.monthlyRentalIncome || 0);
    const surplusAt = (rate) =>
      Math.round(p.netIncomeMonthly - annuity(p.loanNeeded, rate, p.termYears).monthly - fixedOutflow);

    const minRate = 2;
    const maxRate = Math.max(Math.ceil(stressRate + 1), Math.ceil(currentRate + 5), 12);
    const step = 0.25;

    const points = [];
    for (let r = minRate; r <= maxRate + 1e-9; r += step) {
      const rate = Math.round(r * 100) / 100;
      points.push({ rate, surplus: surplusAt(rate) });
    }

    // Break-even rate — linear interpolation across the first zero crossing.
    let breakEvenRate = null;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if ((a.surplus >= 0 && b.surplus < 0) || (a.surplus < 0 && b.surplus >= 0)) {
        const t = a.surplus / (a.surplus - b.surplus);
        breakEvenRate = Math.round((a.rate + t * (b.rate - a.rate)) * 100) / 100;
        break;
      }
    }

    return {
      points,
      currentRate: Math.round(currentRate * 100) / 100,
      stressRate: Math.round(stressRate * 100) / 100,
      breakEvenRate,
      currentSurplus: surplusAt(currentRate),
      stressSurplus: surplusAt(stressRate),
      headroomPP: breakEvenRate != null ? Math.round((breakEvenRate - currentRate) * 100) / 100 : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Monthly housing cost (new home)
  // ---------------------------------------------------------------------------
  function monthlyHousingCost(p) {
    const mortgage = annuity(p.loan, p.rate, p.termYears).monthly;
    const rentalIncome = Math.round(p.monthlyRentalIncome || 0);
    const total = mortgage + p.kommunale + p.insurance + p.maintenance + p.other - rentalIncome;
    return {
      mortgage,
      kommunale: p.kommunale,
      insurance: p.insurance,
      maintenance: p.maintenance,
      other: p.other,
      rentalIncome,
      total, // net of rental income
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
    rentalIncomeSensitivity,
    resilienceCurve,
    monthlyHousingCost,
  };
})();
