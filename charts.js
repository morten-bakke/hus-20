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
  // Cash flow waterfall — "total" steps sit on the zero baseline, "delta"
  // steps float from where the running total was to where it ends up.
  // ---------------------------------------------------------------------------
  function renderCashFlow(canvasId, data) {
    const hasStudentLoan = (data.studentLoan || 0) > 0;

    const steps = [
      { label: 'Brutto', total: true, value: data.grossIncome },
      { label: 'Skatt', total: false, value: -data.tax },
      { label: 'Netto', total: true, value: data.netIncome },
      { label: 'Bolig', total: false, value: -data.housingCosts },
      ...(hasStudentLoan ? [{ label: 'Studielån', total: false, value: -data.studentLoan }] : []),
      { label: 'Leie-inn', total: false, value: data.rentalIncome || 0 },
      { label: 'SIFO', total: false, value: -(data.sifoCosts || 0) },
      { label: 'Strøm', total: false, value: -(data.electricity || 0) },
      { label: 'Til overs', total: true, value: data.remaining },
    ];

    let cumulative = 0;
    const bars = [];
    const colors = [];
    const amounts = []; // signed amount each bar represents, for tooltips
    const connectorY = []; // running total after each step, for the connector lines
    steps.forEach((s) => {
      if (s.total) {
        bars.push([Math.min(0, s.value), Math.max(0, s.value)]);
        colors.push(s.label === 'Til overs' ? (s.value >= 0 ? '#10b981' : '#ef4444') : '#3b82f6');
        amounts.push(s.value);
        cumulative = s.value;
      } else {
        const from = cumulative;
        const to = cumulative + s.value;
        bars.push([Math.min(from, to), Math.max(from, to)]);
        colors.push(s.label === 'Leie-inn' ? '#10b981' : s.label === 'Studielån' ? '#f59e0b' : s.value < 0 ? '#ef4444' : '#10b981');
        amounts.push(s.value);
        cumulative = to;
      }
      connectorY.push(cumulative);
    });

    // No official Chart.js waterfall type exists (and third-party plugins for
    // it target Chart.js v2, incompatible with v4) — draw the connector lines
    // and change labels ourselves with a small chart-scoped plugin instead of
    // a stale dependency.
    const waterfallDecorations = {
      id: 'waterfallDecorations',
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        const yScale = chart.scales.y;
        const { ctx } = chart;

        // Connector lines between consecutive bars
        ctx.save();
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        for (let i = 0; i < meta.data.length - 1; i++) {
          const cur = meta.data[i];
          const next = meta.data[i + 1];
          const y = yScale.getPixelForValue(connectorY[i]);
          ctx.beginPath();
          ctx.moveTo(cur.x + cur.width / 2, y);
          ctx.lineTo(next.x - next.width / 2, y);
          ctx.stroke();
        }
        ctx.restore();

        // Change labels above/below every bar — deltas in green/red with a
        // sign, totals (Brutto, Netto, Til overs) in bold black.
        ctx.save();
        ctx.textAlign = 'center';
        steps.forEach((s, i) => {
          const el = meta.data[i];
          const [lo, hi] = bars[i];
          const amount = amounts[i];
          const text = s.total ? NOK(Math.abs(amount)) : `${amount >= 0 ? '+' : '−'}${NOK(Math.abs(amount))}`;
          ctx.font = s.total ? '600 11px system-ui, sans-serif' : '600 10px system-ui, sans-serif';
          ctx.fillStyle = s.total ? '#1e293b' : (amount >= 0 ? '#059669' : '#dc2626');
          if (amount >= 0) {
            ctx.textBaseline = 'bottom';
            ctx.fillText(text, el.x, yScale.getPixelForValue(hi) - 4);
          } else {
            ctx.textBaseline = 'top';
            ctx.fillText(text, el.x, yScale.getPixelForValue(lo) + 4);
          }
        });
        ctx.restore();
      },
    };

    return getOrCreate(canvasId, {
      type: 'bar',
      data: {
        labels: steps.map((s) => s.label),
        datasets: [{
          data: bars,
          backgroundColor: colors,
        }],
      },
      plugins: [waterfallDecorations],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20, bottom: 20 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const amount = amounts[ctx.dataIndex];
                return `${amount >= 0 ? '+' : '-'}kr ${NOK(Math.abs(amount))}`;
              },
            },
          },
        },
        scales: {
          y: { grid: { display: false }, ticks: { callback: (v) => NOK(v) } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Financing breakdown — single horizontal stacked bar showing where the
  // purchase is funded from: sale equity, savings, loan.
  // ---------------------------------------------------------------------------
  function renderFinancingBreakdown(canvasId, parts) {
    const total = parts.saleEquity + parts.savings + parts.loan;
    const labels = ['Fri EK fra salg', 'Sparepenger', 'Lån'];
    const values = [parts.saleEquity, parts.savings, parts.loan];
    const colors = ['#3b82f6', '#8b5cf6', '#64748b'];
    return getOrCreate(canvasId, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: kr ${NOK(ctx.raw)} (${total > 0 ? Math.round((ctx.raw / total) * 100) : 0}%)`,
            },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Resilience ("tåleevne") — liquidity surplus (y) vs mortgage rate (x).
  // The area is filled green above zero / red below; vertical markers show the
  // current rate, the break-even rate (total tåleevne) and the 3pp stress test.
  // ---------------------------------------------------------------------------
  function renderResilience(canvasId, d) {
    const comma1 = (v) => v.toFixed(1).replace('.', ',');
    const comma2 = (v) => v.toFixed(2).replace('.', ',');
    const linePoints = d.points.map((p) => ({ x: p.rate, y: p.surplus }));

    const annotations = {
      zeroLine: {
        type: 'line', yMin: 0, yMax: 0,
        borderColor: '#94a3b8', borderWidth: 1,
      },
      currentLine: {
        type: 'line', xMin: d.currentRate, xMax: d.currentRate,
        borderColor: '#3b82f6', borderWidth: 2,
        label: {
          display: true, content: `Dagens rente ${comma2(d.currentRate)} %`,
          position: 'end', backgroundColor: '#3b82f6', color: '#fff',
          font: { size: 10 }, padding: 4,
        },
      },
      stressLine: {
        type: 'line', xMin: d.stressRate, xMax: d.stressRate,
        borderColor: '#ef4444', borderWidth: 2, borderDash: [6, 4],
        label: {
          display: true, content: `3 pp-stresstest ${comma1(d.stressRate)} %`,
          position: 'start', backgroundColor: '#ef4444', color: '#fff',
          font: { size: 10 }, padding: 4,
        },
      },
    };
    if (d.breakEvenRate != null) {
      annotations.breakEvenLine = {
        type: 'line', xMin: d.breakEvenRate, xMax: d.breakEvenRate,
        borderColor: '#f59e0b', borderWidth: 2,
        label: {
          display: true, content: `Tåleevne ${comma2(d.breakEvenRate)} %`,
          position: 'center', backgroundColor: '#f59e0b', color: '#fff',
          font: { size: 10 }, padding: 4,
        },
      };
    }

    return getOrCreate(canvasId, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Likviditetsoverskudd',
            data: linePoints,
            borderColor: '#10b981',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
            fill: {
              target: { value: 0 },
              above: 'rgba(16,185,129,0.12)',
              below: 'rgba(239,68,68,0.12)',
            },
            segment: {
              borderColor: (c) => (c.p0.parsed.y < 0 || c.p1.parsed.y < 0 ? '#ef4444' : '#10b981'),
            },
          },
          {
            type: 'scatter',
            label: 'Dagens rente',
            data: [{ x: d.currentRate, y: d.currentSurplus }],
            backgroundColor: '#3b82f6',
            pointRadius: 5,
            pointHoverRadius: 7,
          },
          {
            type: 'scatter',
            label: '3 pp-stresstest',
            data: [{ x: d.stressRate, y: d.stressSurplus }],
            backgroundColor: '#ef4444',
            pointRadius: 5,
            pointHoverRadius: 7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: (items) => `Rente ${comma2(Number(items[0].parsed.x))} %`,
              label: (ctx) => `${ctx.dataset.label}: kr ${NOK(ctx.parsed.y)}/mnd`,
            },
          },
          annotation: { annotations },
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Boliglånsrente (%)' },
            ticks: { callback: (v) => `${v} %` },
          },
          y: {
            title: { display: true, text: 'Likviditetsoverskudd (kr/mnd)' },
            ticks: { callback: (v) => NOK(v) },
          },
        },
      },
    });
  }

  return {
    renderRateSensitivity,
    renderAmortization,
    renderPriceHistory,
    renderCashFlow,
    renderFinancingBreakdown,
    renderResilience,
  };
})();
