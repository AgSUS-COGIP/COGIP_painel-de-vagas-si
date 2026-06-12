import { COLORS } from "./constants.js";
import { alternarFiltroGrafico } from "./filtros.js";
import { charts } from "./runtime.js";
import { escapeAttr, escapeHtml, formatNumber, formatPercent, limitarLabelGrafico, quebrarLabelGrafico, setText } from "./utils.js";

export function renderRankingBars(containerId, items, color, filterType) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const lista = (items || []).filter(item => Number(item.value || 0) > 0);
  const max = Math.max(...lista.map(item => Number(item.value || 0)), 1);

  if (!lista.length) {
    container.innerHTML = '<div class="emptyState">Sem dados para os filtros selecionados.</div>';
    return;
  }

  container.innerHTML = lista.map(item => {
    const valor = Number(item.value || 0);
    const largura = Math.max(4, (valor / max) * 100);
    const label = escapeHtml(item.label || '');
    return `
          <button type="button" class="rankingRow" title="${label}" data-click="filtro-grafico" data-filter-type="${escapeAttr(filterType || '')}" data-filter-value="${escapeAttr(item.label || '')}">
            <span class="rankingLabel">${label}</span>
            <span class="rankingTrack"><span class="rankingFill" style="width:${largura}%; background:${color};"></span></span>
            <strong class="rankingValue">${formatNumber(valor)}</strong>
          </button>
        `;
  }).join('');
}

export function renderProgressBarResumo(cfg) {
  const fill = document.getElementById("barraPreenchidas");
  if (fill) {
    fill.style.width = `${Math.max(0, Math.min(100, Number(cfg.percentual || 0)))}%`;
  }

  setText("kpiPreenchidasPerc", formatPercent(cfg.percentual || 0));
  setText("kpiPreenchidasSub", `${formatNumber(cfg.preenchidas || 0)} de ${formatNumber(cfg.vagasPrevistas || 0)} vagas preenchidas`);
  setText("kpiOciosasSub", `${formatNumber(cfg.ociosas || 0)} vagas ociosas`);
}

// Funil "Os 5 DSEIs com mais vagas previstas" (modelo do painel fixo).
export function renderFunnelDsei(containerId, items, filterType) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const lista = (items || [])
    .filter(item => Number(item.value || 0) > 0)
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, 5);

  if (!lista.length) {
    container.innerHTML = '<div class="emptyState">Sem dados para os filtros selecionados.</div>';
    return;
  }

  container.innerHTML = lista.map((item, index) => {
    const width = 96 - (index * 10);
    const label = escapeHtml(item.label || "-");
    return `
          <button type="button" class="funnelRow" title="${label}" data-click="filtro-grafico" data-filter-type="${escapeAttr(filterType || "")}" data-filter-value="${escapeAttr(item.label || "")}">
            <span class="funnelShape" style="width:${Math.max(48, width)}%"></span>
            <span class="funnelLabel">${label}</span>
            <span class="funnelValue">${formatNumber(item.value)}</span>
          </button>
        `;
  }).join("");
}

// Cards "Top 5 DSEIs com mais vagas ociosas" (modelo do painel fixo).
export function renderCardsOciosas(containerId, items, filterType) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const lista = (items || [])
    .filter(item => Number(item.value || 0) > 0)
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, 5);

  if (!lista.length) {
    container.innerHTML = '<div class="emptyState">Sem dados para os filtros selecionados.</div>';
    return;
  }

  container.innerHTML = lista.map(item => {
    const label = escapeHtml(item.label || "-");
    return `
          <button type="button" class="ociosaCard" title="${label}" data-click="filtro-grafico" data-filter-type="${escapeAttr(filterType || "")}" data-filter-value="${escapeAttr(item.label || "")}">
            <span class="ociosaNome">${label}</span>
            <span class="ociosaValor">${formatNumber(item.value)}</span>
          </button>
        `;
  }).join("");
}

export function renderFunnel(containerId, cfg) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const items = (cfg.items || [])
    .filter(item => Number(item.value || 0) > 0)
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));

  if (!items.length) {
    container.innerHTML = '<div class="emptyState">Sem dados para os filtros selecionados.</div>';
    return;
  }

  container.innerHTML = items.map((item, index) => {
    const width = Math.max(50, 100 - (index * 11));
    const opacity = Math.max(.54, 1 - (index * .09));
    const safeLabel = escapeHtml(item.label || "");

    return `
          <button type="button" class="funnelStep" title="${safeLabel}" data-click="filtro-grafico" data-filter-type="${escapeAttr(cfg.filterType || "")}" data-filter-value="${escapeAttr(item.label || "")}">
            <span class="funnelStepShape" style="width:${width}%; background:${item.color || COLORS.blue}; opacity:${opacity};"></span>
            <span class="funnelStepLabel">${safeLabel}</span>
            <strong class="funnelStepValue">${formatNumber(item.value)}</strong>
          </button>
        `;
  }).join("");
}

export function renderTreemap(containerId, cfg) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const items = (cfg.items || [])
    .filter(item => Number(item.value || 0) > 0)
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));

  if (!items.length) {
    container.innerHTML = '<div class="emptyState">Sem dados para os filtros selecionados.</div>';
    return;
  }

  const total = items.reduce((acc, item) => acc + Number(item.value || 0), 0) || 1;
  container.innerHTML = items.map((item, index) => {
    const basis = Math.max(16, (Number(item.value || 0) / total) * 100);
    const tone = 0.92 - (index * 0.12);
    const safeLabel = escapeHtml(item.label || "");

    return `
          <button type="button" class="treemapNode" style="flex-basis:${basis}%; background:linear-gradient(135deg, rgba(246,178,50,${tone}), rgba(255,133,0,${Math.max(.32, tone - .18)}));" title="${safeLabel}" data-click="filtro-grafico" data-filter-type="${escapeAttr(cfg.filterType || "")}" data-filter-value="${escapeAttr(item.label || "")}">
            <span class="treemapLabel">${safeLabel}</span>
            <strong class="treemapValue">${formatNumber(item.value)}</strong>
          </button>
        `;
  }).join("");
}

export function renderDoughnut(canvasId, cfg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  charts[canvasId] = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: cfg.labels,
      datasets: [{
        data: cfg.values,
        backgroundColor: cfg.colors,
        borderColor: "#ffffff",
        borderWidth: 3,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: cfg.cutout || "60%",
      radius: cfg.radius || undefined,
      onClick: function (event, elements) {
        if (!elements || !elements.length) return;
        const index = elements[0].index;
        if (cfg.filterType && cfg.filterValues) {
          alternarFiltroGrafico(cfg.filterType, cfg.filterValues[index]);
        }
      },
      layout: { padding: cfg.layoutPadding !== undefined ? cfg.layoutPadding : 8 },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: function (context) {
            const values = context.chart.data.datasets[0].data || [];
            const value = Number(values[context.dataIndex] || 0);
            const total = values.reduce((acc, item) => acc + Number(item || 0), 0);
            const pct = total > 0 ? (value / total) * 100 : 0;
            return pct >= (cfg.datalabelMin || 8);
          },
          // Rótulos externos (fora da rosca) para leitura clara dos percentuais.
          anchor: cfg.datalabelAnchor || "end",
          align: cfg.datalabelAlign || "end",
          offset: cfg.datalabelOffset || 10,
          clamp: true,
          clip: false,
          color: "#07346b",
          backgroundColor: "rgba(255, 255, 255, .96)",
          borderColor: "rgba(7, 52, 107, .16)",
          borderWidth: 1,
          borderRadius: 10,
          padding: { top: 4, right: 6, bottom: 4, left: 6 },
          font: { size: cfg.datalabelFontSize || 13, weight: "900" },
          formatter: function (value, context) {
            const values = context.chart.data.datasets[0].data || [];
            const total = values.reduce((acc, item) => acc + Number(item || 0), 0);
            const pct = total > 0 ? (Number(value || 0) / total) * 100 : 0;
            return formatPercent(pct);
          }
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              const total = ctx.dataset.data.reduce((acc, item) => acc + Number(item || 0), 0);
              const pct = total > 0 ? (Number(ctx.raw || 0) / total) * 100 : 0;
              return `${ctx.label}: ${formatNumber(ctx.raw)} (${formatPercent(pct)})`;
            }
          }
        }
      }
    },
    plugins: [centerTextPlugin(cfg.center, cfg.centerSub, cfg.centerFontSize, cfg.centerSubFontSize)]
  });
}

export function renderBar(canvasId, cfg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  const labelsOriginais = cfg.labels || [];
  const labelsGrafico = cfg.wrapLabels
    ? labelsOriginais.map(label => quebrarLabelGrafico(label, cfg.maxCharsPerLine || 18, cfg.maxLines || 2))
    : labelsOriginais;

  charts[canvasId] = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labelsGrafico,
      datasets: [{
        data: cfg.values,
        backgroundColor: cfg.color,
        borderRadius: 7,
        barPercentage: cfg.barPercentage || .70,
        categoryPercentage: cfg.categoryPercentage || .70
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      onClick: function (event, elements) {
        if (!elements || !elements.length) return;
        const index = elements[0].index;
        if (cfg.filterType && cfg.filterValues) {
          alternarFiltroGrafico(cfg.filterType, cfg.filterValues[index]);
        }
      },
      layout: {
        padding: { right: cfg.rightPadding ?? 44, left: cfg.leftPadding ?? 0, top: cfg.topPadding ?? 4, bottom: cfg.bottomPadding ?? 2 }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "right",
          color: "#07346b",
          font: { size: cfg.dataLabelFontSize || 12, weight: "900" },
          formatter: value => formatNumber(value),
          clip: false
        },
        tooltip: {
          callbacks: {
            title: function (items) {
              if (!items || !items.length) return "";
              return labelsOriginais[items[0].dataIndex] || "";
            },
            label: ctx => formatNumber(ctx.raw)
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: "rgba(0, 83, 166, .12)" },
          ticks: {
            color: "rgba(7, 52, 107, .72)",
            font: { size: cfg.xTickFontSize || 10.5, weight: "700" }
          }
        },
        y: {
          afterFit: function (scale) {
            if (cfg.yAxisWidth) {
              const larguraGrafico = scale && scale.chart ? Number(scale.chart.width || 0) : 0;
              const larguraMaxima = larguraGrafico > 0 ? Math.max(120, larguraGrafico * 0.56) : cfg.yAxisWidth;
              scale.width = Math.min(cfg.yAxisWidth, larguraMaxima);
            }
          },
          grid: { display: false },
          ticks: {
            autoSkip: false,
            color: "#07346b",
            padding: 4,
            font: { size: cfg.labelFontSize || 11, weight: "900" }
          }
        }
      }
    }
  });
}

export function renderColumn(canvasId, cfg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  const labelsOriginais = cfg.labels || [];
  const labelsCurtos = labelsOriginais.map(label => limitarLabelGrafico(label, cfg.maxLabelLength || 14));

  charts[canvasId] = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labelsCurtos,
      datasets: [{
        data: cfg.values,
        backgroundColor: cfg.color,
        borderRadius: 8,
        barPercentage: .62,
        categoryPercentage: .74
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: function (event, elements) {
        if (!elements || !elements.length) return;
        const index = elements[0].index;
        if (cfg.filterType && cfg.filterValues) {
          alternarFiltroGrafico(cfg.filterType, cfg.filterValues[index]);
        }
      },
      layout: {
        padding: { top: 20, right: 10, bottom: 8, left: 8 }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "top",
          offset: 2,
          color: "#07346b",
          font: { size: 11, weight: "900" },
          formatter: value => formatNumber(value),
          clip: false
        },
        tooltip: {
          callbacks: {
            title: function (items) {
              if (!items || !items.length) return "";
              return labelsOriginais[items[0].dataIndex] || "";
            },
            label: ctx => formatNumber(ctx.raw)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0, 83, 166, .12)" },
          ticks: {
            color: "rgba(7, 52, 107, .72)",
            font: { size: 10, weight: "800" }
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            color: "#07346b",
            font: { size: 9.5, weight: "900" },
            maxRotation: 0,
            minRotation: 0
          }
        }
      }
    }
  });
}

export function centerTextPlugin(text, subtext, fontSize, subFontSize) {
  return {
    id: "centerText" + Math.random().toString(36).slice(2),
    beforeDraw(chart) {
      const area = chart.chartArea;
      if (!area) return;

      const ctx = chart.ctx;
      const centerX = (area.left + area.right) / 2;
      const centerY = (area.top + area.bottom) / 2;
      const meta = chart.getDatasetMeta(0);
      const firstArc = meta && meta.data && meta.data[0];
      const innerRadius = firstArc && firstArc.innerRadius ? firstArc.innerRadius : Math.min(area.width, area.height) * .26;
      const maxTextWidth = Math.max(42, innerRadius * 1.54);
      const mainText = text || "0";
      const subText = subtext || "";

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      let mainFontSize = fontSize || 25;
      ctx.font = `900 ${mainFontSize}px Arial`;
      while (ctx.measureText(mainText).width > maxTextWidth && mainFontSize > 14) {
        mainFontSize -= 1;
        ctx.font = `900 ${mainFontSize}px Arial`;
      }

      ctx.fillStyle = "#07346b";
      ctx.fillText(mainText, centerX, subText ? centerY - 6 : centerY);

      if (subText) {
        let secondaryFontSize = subFontSize || 9;
        ctx.font = `900 ${secondaryFontSize}px Arial`;
        while (ctx.measureText(subText).width > maxTextWidth && secondaryFontSize > 7) {
          secondaryFontSize -= 1;
          ctx.font = `900 ${secondaryFontSize}px Arial`;
        }

        ctx.fillStyle = "rgba(7, 52, 107, .72)";
        ctx.fillText(subText, centerX, centerY + Math.max(16, mainFontSize * .85));
      }

      ctx.restore();
    }
  };
}

export function renderLegend(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = items.map(([label, value, color, pct]) => `
        <div class="legendItem">
          <span class="dot" style="background:${color};"></span>
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${formatNumber(value)} (${formatPercent(pct)})</strong>
          </div>
        </div>
      `).join("");
}
