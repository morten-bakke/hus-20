// =============================================================================
// Boligkalkulator Oslo — Chart.js Visualizations
// =============================================================================

window.Charts = (function () {
  const registry = {};

  function getOrCreate(canvasId, config) {
    if (registry[canvasId]) {
      registry[canvasId].destroy();
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    registry[canvasId] = new Chart(ctx, config);
    return registry[canvasId];
  }

  const NOK = (v) => new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(v);

  // ---------------------------------------------------------------------------
  // Rate sensitivity bar chart
  // ---------------------------------------------------------------------------
  function renderRateSensitivity(canvasId, data) {
    const colors = data.map((d) =>
      d.isCurrentRate ? '#3b82f6' : d.isStressTest ? '#ef4444' : '#94a3b8'
    );
    return getOrCreate(canvasId, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.rate.toFixed(1) + '%'),
        datasets: [{
          label: 'Månedlig kostnad',
          data: data.map((d) => d.monthlyPayment),
          backgroundColor: colors,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `kr ${NOK(ctx.raw)}/mnd | ${(data[ctx.dataIndex].debtServiceRatioGross * 100).toFixed(1)}% av brutto`,
            },
          },
          annotation: {
            annotations: {
              stressLine: {
                type: 'line',
                yMin: data.find((d) => d.isStressTest)?.monthlyPayment,
                yMax: data.find((d) => d.isStressTest)?.monthlyPayment,
                borderColor: '#ef4444',
                borderWidth: 2,
                borderDash: [6, 4],
                label: { content: 'Stresstest', display: true, position: 'start', backgroundColor: '#ef4444' },
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: false,
            ticks: { callback: (v) => NOK(v) },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Renovation timeline
  // ---------------------------------------------------------------------------
  function renderRenovationTimeline(canvasId, data, renovationAmount) {
    const feasibleIdx = data.years.findIndex((y) => y.renovationFeasible);
    return getOrCreate(canvasId, {
      type: 'line',
      data: {
        labels: data.years.map((y) => `År ${y.year}`),
        datasets: [
          {
            label: 'Boligverdi',
            data: data.years.map((y) => y.propertyValue),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.1)',
            fill: false,
            tension: 0.3,
          },
          {
            label: 'Gjenstående lån',
            data: data.years.map((y) => y.remainingLoan),
            borderColor: '#ef4444',
            fill: false,
            tension: 0.3,
          },
          {
            label: 'Maks tilleggslån',
            data: data.years.map((y) => y.maxAdditional),
            borderColor: '#10b981',
            borderDash: [5, 5],
            fill: false,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: kr ${NOK(ctx.raw)}`,
            },
          },
          annotation: {
            annotations: {
              renovationLine: {
                type: 'line',
                yMin: renovationAmount,
                yMax: renovationAmount,
                borderColor: '#f59e0b',
                borderWidth: 2,
                borderDash: [6, 4],
                label: { content: `Renovering: ${NOK(renovationAmount)}`, display: true, position: 'start', backgroundColor: '#f59e0b' },
              },
              ...(feasibleIdx >= 0 ? {
                feasiblePoint: {
                  type: 'point',
                  xValue: feasibleIdx,
                  yValue: data.years[feasibleIdx].maxAdditional,
                  backgroundColor: '#10b981',
                  radius: 8,
                  borderColor: '#fff',
                  borderWidth: 2,
                },
              } : {}),
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: (v) => (v / 1e6).toFixed(1) + 'M' },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Net worth trajectory
  // ---------------------------------------------------------------------------
  function renderNetWorth(canvasId, data) {
    return getOrCreate(canvasId, {
      type: 'line',
      data: {
        labels: data.map((y) => `År ${y.year}`),
        datasets: [
          {
            label: 'Netto formue (bolig)',
            data: data.map((y) => y.netWorthProperty),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.15)',
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Alternativ: indeksfond',
            data: data.map((y) => y.investmentValue),
            borderColor: '#f59e0b',
            borderDash: [5, 5],
            fill: false,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: kr ${NOK(ctx.raw)}`,
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: (v) => (v / 1e6).toFixed(1) + 'M' },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Cost comparison (horizontal stacked bar)
  // ---------------------------------------------------------------------------
  function renderCostComparison(canvasId, costs) {
    return getOrCreate(canvasId, {
      type: 'bar',
      data: {
        labels: ['Nåværende', 'Ny bolig'],
        datasets: [
          {
            label: 'Lån',
            data: [costs.current.mortgage, costs.new.mortgage],
            backgroundColor: '#3b82f6',
          },
          {
            label: 'Felleskost./Komm.avg.',
            data: [costs.current.fellesutgifter, costs.new.kommunale],
            backgroundColor: '#6366f1',
          },
          {
            label: 'Forsikring',
            data: [costs.current.insurance, costs.new.insurance],
            backgroundColor: '#8b5cf6',
          },
          {
            label: 'Vedlikehold',
            data: [0, costs.new.maintenance],
            backgroundColor: '#a78bfa',
          },
          {
            label: 'Leieinntekt (fratrekk)',
            data: [0, -(costs.new.rentalIncome || 0)],
            backgroundColor: '#10b981',
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: kr ${NOK(Math.abs(ctx.raw))}${ctx.raw < 0 ? ' (inntekt)' : ''}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { callback: (v) => NOK(v) },
          },
          y: { stacked: true },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Amortization chart
  // ---------------------------------------------------------------------------
  function renderAmortization(canvasId, schedule) {
    return getOrCreate(canvasId, {
      type: 'bar',
      data: {
        labels: schedule.map((y) => `År ${y.year}`),
        datasets: [
          {
            label: 'Avdrag',
            data: schedule.map((y) => y.principal),
            backgroundColor: '#3b82f6',
          },
          {
            label: 'Renter',
            data: schedule.map((y) => y.interest),
            backgroundColor: '#ef4444',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: kr ${NOK(ctx.raw)}`,
            },
          },
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            ticks: { callback: (v) => NOK(v) },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Oslo price history chart
  // ---------------------------------------------------------------------------
  function renderPriceHistory(canvasId, historyData) {
    return getOrCreate(canvasId, {
      type: 'line',
      data: {
        labels: historyData.map((d) => d.year),
        datasets: [
          {
            label: 'Prisindeks Oslo (2015=100)',
            data: historyData.map((d) => d.index),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.15)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const d = historyData[ctx.dataIndex];
                return `Indeks: ${d.index} | Endring: ${d.change}%`;
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: false },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Cash flow waterfall
  // ---------------------------------------------------------------------------
  function renderCashFlow(canvasId, data) {
    const labels = ['Brutto', 'Skatt', 'Netto', 'Bolig', 'Leie-inn', 'SIFO', 'Strøm', 'Til overs'];
    const values = [data.grossIncome, -data.tax, data.netIncome, -data.housingCosts,
      data.rentalIncome || 0, -(data.sifoCosts || 0), -(data.electricity || 0), data.remaining];
    const colors = values.map((v, i) => {
      if (i === 0 || i === 2) return '#3b82f6';
      if (i === 4) return '#10b981';
      if (i === 7) return v >= 0 ? '#10b981' : '#ef4444';
      if (v < 0) return '#ef4444';
      return '#10b981';
    });

    return getOrCreate(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values.map(Math.abs),
          backgroundColor: colors,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { callback: (v) => NOK(v) } },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Upgrade comparison (stay vs buy net worth)
  // ---------------------------------------------------------------------------
  function renderUpgradeComparison(canvasId, data) {
    const yrs = data.years.filter((y) => y.year <= 20);
    return getOrCreate(canvasId, {
      type: 'line',
      data: {
        labels: yrs.map((y) => `År ${y.year}`),
        datasets: [
          {
            label: 'Bli boende (netto formue)',
            data: yrs.map((y) => y.stayNetWorth),
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99,102,241,0.1)',
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Kjøpe hus (netto formue)',
            data: yrs.map((y) => y.buyNetWorth),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.1)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: kr ${NOK(ctx.raw)}`,
            },
          },
          annotation: {
            annotations: data.breakEvenYear ? {
              breakEven: {
                type: 'line',
                xMin: data.breakEvenYear,
                xMax: data.breakEvenYear,
                borderColor: '#f59e0b',
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                  content: `Break-even: År ${data.breakEvenYear}`,
                  display: true,
                  position: 'start',
                  backgroundColor: '#f59e0b',
                },
              },
            } : {},
          },
        },
        scales: {
          y: {
            ticks: { callback: (v) => (v / 1e6).toFixed(1) + 'M' },
          },
        },
      },
    });
  }

  return {
    renderRateSensitivity,
    renderRenovationTimeline,
    renderNetWorth,
    renderCostComparison,
    renderAmortization,
    renderPriceHistory,
    renderCashFlow,
    renderUpgradeComparison,
  };
})();
