// ==========================================================
// STATE & UTILITIES — Modern UI (Option 2 + C + F)
// ==========================================================
const express  = require('express')
const sqlite3  = require('sqlite3').verbose()
const csv      = require('csv-parser')
const chokidar = require('chokidar')
const fs       = require('fs')
const path     = require('path')

const app = express()   // ← THIS LINE IS MISSING IN YOUR FILE
const PORT = 3000

app.use(express.static('public'))


let allSalesData   = []
let allPLData      = []
let currentChart   = null
let brandChart     = null
let custChart      = null
let currentPLChart = null
let chartColor     = '#4F81BD'

let salesDrillLabel = null
let plDrillCategory = null

const monthOrder = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
]

function formatK(v) {
    return (v / 1000).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + 'K'
}

function truncate(str, n) {
    return str && str.length > n ? str.slice(0, n) + '…' : str
}

function unique(data, key) {
    return [...new Set(data.map(d => d[key]).filter(Boolean))]
}

function setOpts(id, values) {
    const el = document.getElementById(id)
    if (!el) return
    el.innerHTML = values
        .map(v => `<option value="${v}">${v}</option>`)
        .join('')
}// ==========================================================
// INIT
// ==========================================================
async function init() {
    try {
        const [sRes, pRes] = await Promise.all([
            fetch('/sales'),
            fetch('/pl')
        ])

        allSalesData = await sRes.json()
        allPLData    = await pRes.json()

        setupTabs()
        populateSalesFilters()
        renderSalesChart()
        populatePLFilters()
        renderPL()
        setupPLComparison()
    } catch (e) {
        console.error('Init error:', e)
    }
}

// ==========================================================
// TABS
// ==========================================================
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn')
                .forEach(b => b.classList.remove('active'))

            btn.classList.add('active')

            const tab = btn.dataset.tab

            document.getElementById('salesView').style.display      = tab === 'sales'     ? 'block' : 'none'
            document.getElementById('plView').style.display         = tab === 'pl'        ? 'block' : 'none'
            document.getElementById('plCompareView').style.display  = tab === 'plCompare' ? 'block' : 'none'
        })
    })
}// ==========================================================
// SALES — FILTERS
// ==========================================================
function populateSalesFilters() {
    const d = allSalesData

    setOpts('companyFilter',  ['All', ...unique(d, 'company')])
    setOpts('yearFilter',     ['All', ...[...new Set(d.map(x => String(x.year)).filter(Boolean))].sort()])
    setOpts('monthFilter',    ['All', ...monthOrder.filter(m => d.some(x => x.month === m))])
    setOpts('brandFilter',    ['All', ...unique(d, 'brand')])
    setOpts('customerFilter', ['All', ...unique(d, 'customer')])
    setOpts('salesmanFilter', ['All', ...unique(d, 'salesman')])
    setOpts('divisionFilter', ['All', ...unique(d, 'division')])

    document.getElementById('companyFilter').addEventListener('change', () => {
        const sel = document.getElementById('companyFilter').value
        const sub = sel === 'All' ? d : d.filter(x => x.company === sel)
        setOpts('divisionFilter', ['All', ...unique(sub, 'division')])
        closeSalesDrill()
        renderSalesChart()
    })

    ;['yearFilter','monthFilter','brandFilter','customerFilter','salesmanFilter','divisionFilter']
        .forEach(id => document.getElementById(id).addEventListener('change', () => {
            closeSalesDrill()
            renderSalesChart()
        }))

    document.getElementById('resetBtn').addEventListener('click', () => {
        ;['companyFilter','divisionFilter','yearFilter','monthFilter','brandFilter','customerFilter','salesmanFilter']
            .forEach(id => document.getElementById(id).selectedIndex = 0)
        closeSalesDrill()
        renderSalesChart()
    })

    const cp = document.getElementById('colorPicker')
    if (cp) {
        cp.addEventListener('input', e => {
            chartColor = e.target.value || '#4F81BD'
            renderSalesChart()
            renderPL()
        })
    }
}

function getSalesFiltered() {
    const g = id => document.getElementById(id).value

    return allSalesData.filter(d => {
        if (g('companyFilter')  !== 'All' && d.company      !== g('companyFilter'))  return false
        if (g('divisionFilter') !== 'All' && d.division     !== g('divisionFilter')) return false
        if (g('yearFilter')     !== 'All' && String(d.year) !== g('yearFilter'))     return false
        if (g('monthFilter')    !== 'All' && d.month        !== g('monthFilter'))    return false
        if (g('brandFilter')    !== 'All' && d.brand        !== g('brandFilter'))    return false
        if (g('customerFilter') !== 'All' && d.customer     !== g('customerFilter')) return false
        if (g('salesmanFilter') !== 'All' && d.salesman     !== g('salesmanFilter')) return false
        return true
    })
    }// ==========================================================
// SALES — MAIN CHART
// ==========================================================
let _salesLabels = []
let _salesValues = []
let _salesRows   = []

function renderSalesChart() {
    hideTooltip()

    const data    = getSalesFiltered()
    const grouped = {}

    data.forEach(d => {
        const key = `${d.month} ${d.year}`
        if (!grouped[key]) grouped[key] = { sales: 0, rows: [] }
        grouped[key].sales += d.net_sales
        grouped[key].rows.push(d)
    })

    const sortedKeys = Object.keys(grouped).sort((a, b) => {
        const [aM, aY] = a.split(' ')
        const [bM, bY] = b.split(' ')
        return aY !== bY
            ? parseInt(aY) - parseInt(bY)
            : monthOrder.indexOf(aM) - monthOrder.indexOf(bM)
    })

    _salesLabels = sortedKeys
    _salesValues = sortedKeys.map(k => grouped[k].sales)
    _salesRows   = sortedKeys.map(k => grouped[k].rows)

    document.getElementById('kpiTotal').textContent   = formatK(_salesValues.reduce((s, v) => s + v, 0))
    document.getElementById('kpiPeriods').textContent = _salesLabels.length

    if (currentChart) currentChart.destroy()

    const nBars    = _salesLabels.length || 1
    const barPct   = Math.min(0.35, 6 / nBars)
    const drillIdx = salesDrillLabel ? _salesLabels.indexOf(salesDrillLabel) : -1

    const bgColors = _salesValues.map((_, i) =>
        drillIdx === -1
            ? chartColor + 'CC'
            : i === drillIdx
                ? chartColor
                : chartColor + '33'
    )

    const brColors = _salesValues.map((_, i) =>
        drillIdx === -1
            ? chartColor
            : i === drillIdx
                ? chartColor
                : chartColor + '33'
    )

    const ctx = document.getElementById('salesChart').getContext('2d')

    currentChart = new Chart(ctx, {
        data: {
            labels: _salesLabels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Net Sales',
                    data: _salesValues,
                    backgroundColor: bgColors,
                    borderColor: brColors,
                    borderWidth: 1,
                    borderRadius: 3,
                    categoryPercentage: barPct,
                    barPercentage: 0.9,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: 'Trend',
                    data: _salesValues,
                    borderColor: '#E8603C',
                    borderWidth: 2,
                    pointBackgroundColor: _salesValues.map((_, i) =>
                        drillIdx === -1 || i === drillIdx
                            ? '#E8603C'
                            : '#E8603C33'
                    ),
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    fill: false,
                    tension: 0.35,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 28 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        boxWidth: 10,
                        boxHeight: 10,
                        font: { size: 11 },
                        color: '#666'
                    }
                },
                tooltip: { enabled: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: '#888',
                        font: { size: 11 },
                        maxRotation: 45,
                        minRotation: 30,
                        autoSkip: _salesLabels.length > 28
                    }
                },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { display: false }
                }
            },
            onHover: (event, activeElements) => {
                document.getElementById('salesChart').style.cursor =
                    activeElements.length ? 'pointer' : 'default'

                if (activeElements.length > 0) {
                    showMiniBarTooltip(
                        event,
                        _salesRows[activeElements[0].index],
                        _salesLabels[activeElements[0].index]
                    )
                } else {
                    hideTooltip()
                }
            },
            onClick: (event, activeElements) => {
                if (!activeElements.length) return

                const clicked = _salesLabels[activeElements[0].index]

                if (salesDrillLabel === clicked) {
                    closeSalesDrill()
                } else {
                    salesDrillLabel = clicked
                    renderSalesChart()
                    renderSalesDrillPanels()
                }
            }
        },
        plugins: [{
            id: 'valueLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart
                chart.getDatasetMeta(0).data.forEach((bar, i) => {
                    ctx.save()
                    ctx.fillStyle =
                        drillIdx !== -1 && i !== drillIdx ? '#bbb' : '#555'
                    ctx.font = '10px Segoe UI, sans-serif'
                    ctx.textAlign = 'center'
                    ctx.fillText(formatK(_salesValues[i]), bar.x, bar.y - 6)
                    ctx.restore()
                })
            }
        }]
    })

    if (salesDrillLabel) renderSalesDrillPanels()
        }// ==========================================================
// SALES — DRILL PANELS
// ==========================================================
function renderSalesDrillPanels() {
    const label     = salesDrillLabel
    const [mon, yr] = label.split(' ')
    const rows      = getSalesFiltered().filter(d => d.month === mon && String(d.year) === yr)

    const brandMap = {}
    const custMap  = {}

    rows.forEach(r => {
        const b = r.brand    || 'Unknown'
        const c = r.customer || 'Unknown'
        if (!brandMap[b]) brandMap[b] = 0
        if (!custMap[c])  custMap[c]  = 0
        brandMap[b] += r.net_sales
        custMap[c]  += r.net_sales
    })

    const top10Brands = Object.entries(brandMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)

    const top10Custs = Object.entries(custMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)

    document.getElementById('salesDrillPanel').style.display = 'block'
    document.getElementById('salesDrillTitle').textContent   = `${label} — Breakdown`

    if (brandChart) { brandChart.destroy(); brandChart = null }
    if (custChart)  { custChart.destroy();  custChart  = null }

    brandChart = buildDrillChart('brandChart', top10Brands, chartColor)
    custChart  = buildDrillChart('custChart',  top10Custs,  '#8E6BBF')
}

function buildDrillChart(canvasId, top10, color) {
    const values = top10.map(([, v]) => v)

    return new Chart(document.getElementById(canvasId).getContext('2d'), {
        type: 'bar',
        data: {
            labels: top10.map(([n]) => truncate(n, 20)),
            datasets: [{
                label: 'Sales',
                data: values,
                backgroundColor: color + 'CC',
                borderColor: color,
                borderWidth: 1,
                borderRadius: 3,
                categoryPercentage: Math.min(0.5, 5 / (top10.length || 1)),
                barPercentage: 0.85
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 22 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: item => ' ' + formatK(item.raw)
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: '#888',
                        font: { size: 10 },
                        maxRotation: 40,
                        minRotation: 30
                    }
                },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { display: false }
                }
            }
        },
        plugins: [{
            id: 'drillValLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart
                chart.getDatasetMeta(0).data.forEach((bar, i) => {
                    ctx.save()
                    ctx.fillStyle = color
                    ctx.font = '10px Segoe UI, sans-serif'
                    ctx.textAlign = 'center'
                    ctx.fillText(formatK(values[i]), bar.x, bar.y - 5)
                    ctx.restore()
                })
            }
        }]
    })
}

function closeSalesDrill() {
    salesDrillLabel = null
    document.getElementById('salesDrillPanel').style.display = 'none'

    if (brandChart) { brandChart.destroy(); brandChart = null }
    if (custChart)  { custChart.destroy();  custChart  = null }

    if (currentChart) {
        currentChart.destroy()
        currentChart = null
    }
}
// ==========================================================
// SALES — MINI TOOLTIP
// ==========================================================
function showMiniBarTooltip(evt, rows, label) {
    const tip = document.getElementById('miniBarTooltip')
    if (!tip) return

    const rect = evt.chart.canvas.getBoundingClientRect()
    tip.style.left = (evt.x + rect.left + 10) + 'px'
    tip.style.top  = (evt.y + rect.top  + 10) + 'px'

    let html = `<div class="tip-title">${label}</div>`
    rows.slice(0, 10).forEach(r => {
        html += `
            <div class="tip-row">
                <span>${truncate(r.brand || 'Unknown', 18)}</span>
                <span>${formatK(r.net_sales)}</span>
            </div>
        `
    })

    if (rows.length > 10) {
        html += `<div class="tip-more">+${rows.length - 10} more…</div>`
    }

    tip.innerHTML = html
    tip.style.display = 'block'
}

function hideTooltip() {
    const tip = document.getElementById('miniBarTooltip')
    if (tip) tip.style.display = 'none'
}
// ==========================================================
// P&L — FILTERS
// ==========================================================
function populatePLFilters() {
    const d = allPLData

    setOpts('plCompanyFilter',  ['All', ...unique(d, 'company')])
    setOpts('plYearFilter',     ['All', ...[...new Set(d.map(x => String(x.year)).filter(Boolean))].sort()])
    setOpts('plMonthFilter',    ['All', ...monthOrder.filter(m => d.some(x => x.month === m))])
    setOpts('plDivisionFilter', ['All', ...unique(d, 'division')])

    ;['plCompanyFilter','plYearFilter','plMonthFilter','plDivisionFilter']
        .forEach(id => document.getElementById(id).addEventListener('change', renderPL))

    document.getElementById('plResetBtn').addEventListener('click', () => {
        ;['plCompanyFilter','plYearFilter','plMonthFilter','plDivisionFilter']
            .forEach(id => document.getElementById(id).selectedIndex = 0)
        renderPL()
    })
}

function getPLFiltered() {
    const g = id => document.getElementById(id).value

    return allPLData.filter(d => {
        if (g('plCompanyFilter')  !== 'All' && d.company      !== g('plCompanyFilter'))  return false
        if (g('plDivisionFilter') !== 'All' && d.division     !== g('plDivisionFilter')) return false
        if (g('plYearFilter')     !== 'All' && String(d.year) !== g('plYearFilter'))     return false
        if (g('plMonthFilter')    !== 'All' && d.month        !== g('plMonthFilter'))    return false
        return true
    })
}
// ==========================================================
// P&L — MAIN RENDER
// ==========================================================
function renderPL() {
    const d = getPLFiltered()

    const grouped = {}
    d.forEach(r => {
        const key = `${r.month} ${r.year}`
        if (!grouped[key]) grouped[key] = { rev: 0, gp: 0, np: 0, opex: 0 }
        grouped[key].rev  += r.revenue
        grouped[key].gp   += r.gross_profit
        grouped[key].np   += r.net_profit
        grouped[key].opex += r.opex
    })

    const sortedKeys = Object.keys(grouped).sort((a, b) => {
        const [aM, aY] = a.split(' ')
        const [bM, bY] = b.split(' ')
        return aY !== bY
            ? parseInt(aY) - parseInt(bY)
            : monthOrder.indexOf(aM) - monthOrder.indexOf(bM)
    })

    const labels = sortedKeys
    const rev    = labels.map(k => grouped[k].rev)
    const gp     = labels.map(k => grouped[k].gp)
    const np     = labels.map(k => grouped[k].np)
    const opex   = labels.map(k => grouped[k].opex)

    if (currentPLChart) currentPLChart.destroy()

    const ctx = document.getElementById('plChart').getContext('2d')

    currentPLChart = new Chart(ctx, {
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Revenue',
                    data: rev,
                    backgroundColor: chartColor + 'CC',
                    borderColor: chartColor,
                    borderWidth: 1,
                    borderRadius: 3,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: 'Gross Profit',
                    data: gp,
                    borderColor: '#2E7D32',
                    borderWidth: 2,
                    pointBackgroundColor: '#2E7D32',
                    tension: 0.35,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: 'Net Profit',
                    data: np,
                    borderColor: '#6A1B9A',
                    borderWidth: 2,
                    pointBackgroundColor: '#6A1B9A',
                    tension: 0.35,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: 'Operating Expenses',
                    data: opex,
                    borderColor: '#C0392B',
                    borderWidth: 2,
                    pointBackgroundColor: '#C0392B',
                    tension: 0.35,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 28 } },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        boxWidth: 10,
                        boxHeight: 10,
                        font: { size: 11 },
                        color: '#666'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: item => ' ' + formatK(item.raw)
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: '#888',
                        font: { size: 11 },
                        maxRotation: 45,
                        minRotation: 30
                    }
                },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { display: false }
                }
            }
        }
    })
}
// ==========================================================
// P&L — COMPARISON SETUP
// ==========================================================
function setupPLComparison() {
    const d = allPLData

    setOpts('plCompCompanyA',  ['All', ...unique(d, 'company')])
    setOpts('plCompCompanyB',  ['All', ...unique(d, 'company')])
    setOpts('plCompYearA',     ['All', ...[...new Set(d.map(x => String(x.year)).filter(Boolean))].sort()])
    setOpts('plCompYearB',     ['All', ...[...new Set(d.map(x => String(x.year)).filter(Boolean))].sort()])
    setOpts('plCompMonthA',    ['All', ...monthOrder.filter(m => d.some(x => x.month === m))])
    setOpts('plCompMonthB',    ['All', ...monthOrder.filter(m => d.some(x => x.month === m))])
    setOpts('plCompDivisionA', ['All', ...unique(d, 'division')])
    setOpts('plCompDivisionB', ['All', ...unique(d, 'division')])

    ;[
        'plCompCompanyA','plCompCompanyB',
        'plCompYearA','plCompYearB',
        'plCompMonthA','plCompMonthB',
        'plCompDivisionA','plCompDivisionB'
    ].forEach(id => {
        document.getElementById(id).addEventListener('change', renderPLComparison)
    })

    document.getElementById('plCompResetBtn').addEventListener('click', () => {
        ;[
            'plCompCompanyA','plCompCompanyB',
            'plCompYearA','plCompYearB',
            'plCompMonthA','plCompMonthB',
            'plCompDivisionA','plCompDivisionB'
        ].forEach(id => document.getElementById(id).selectedIndex = 0)
        renderPLComparison()
    })

    renderPLComparison()
}

// ==========================================================
// P&L — COMPARISON RENDER
// ==========================================================
function renderPLComparison() {
    const g = id => document.getElementById(id).value

    const fA = allPLData.filter(d => {
        if (g('plCompCompanyA')  !== 'All' && d.company      !== g('plCompCompanyA'))  return false
        if (g('plCompDivisionA') !== 'All' && d.division     !== g('plCompDivisionA')) return false
        if (g('plCompYearA')     !== 'All' && String(d.year) !== g('plCompYearA'))     return false
        if (g('plCompMonthA')    !== 'All' && d.month        !== g('plCompMonthA'))    return false
        return true
    })

    const fB = allPLData.filter(d => {
        if (g('plCompCompanyB')  !== 'All' && d.company      !== g('plCompCompanyB'))  return false
        if (g('plCompDivisionB') !== 'All' && d.division     !== g('plCompDivisionB')) return false
        if (g('plCompYearB')     !== 'All' && String(d.year) !== g('plCompYearB'))     return false
        if (g('plCompMonthB')    !== 'All' && d.month        !== g('plCompMonthB'))    return false
        return true
    })

    const sum = arr => arr.reduce((s, v) => s + v, 0)

    const revA  = sum(fA.map(x => x.revenue))
    const gpA   = sum(fA.map(x => x.gross_profit))
    const npA   = sum(fA.map(x => x.net_profit))
    const opA   = sum(fA.map(x => x.opex))

    const revB  = sum(fB.map(x => x.revenue))
    const gpB   = sum(fB.map(x => x.gross_profit))
    const npB   = sum(fB.map(x => x.net_profit))
    const opB   = sum(fB.map(x => x.opex))

    const rows = [
        { label: 'Revenue',          a: revA, b: revB },
        { label: 'Gross Profit',     a: gpA,  b: gpB },
        { label: 'Net Profit',       a: npA,  b: npB },
        { label: 'Operating Expense',a: opA,  b: opB }
    ]

    const body = document.getElementById('plCompTableBody')
    body.innerHTML = ''

    rows.forEach(r => {
        const a = r.a
        const b = r.b
        const varVal = a - b
        const varPct = b !== 0 ? (varVal / b) * 100 : 0

        const negA = a < 0
        const negB = b < 0
        const negV = varVal < 0

        const tr = document.createElement('tr')
        tr.innerHTML = `
            <td>${r.label}</td>
            <td class="num" style="${negA ? 'color:#c0392b;' : ''}">
                ${negA ? '(' + formatK(Math.abs(a)) + ')' : formatK(a)}
            </td>
            <td class="num" style="${negB ? 'color:#c0392b;' : ''}">
                ${negB ? '(' + formatK(Math.abs(b)) + ')' : formatK(b)}
            </td>
            <td class="num" style="${negV ? 'color:#c0392b;' : 'color:#2e7d32;'}">
                ${negV ? '(' + formatK(Math.abs(varVal)) + ')' : formatK(varVal)}
            </td>
            <td class="num" style="color:#777;">${varPct.toFixed(1)}%</td>
        `
        body.appendChild(tr)
    })
    // --- CONTINUATION OF renderPLComparison() ---
    const setKpi = (idVar, idSub, a, b, label) => {
        const v   = a - b
        const pct = b !== 0 ? (v / b) * 100 : 0
        const neg = v < 0

        const elVar = document.getElementById(idVar)
        const elSub = document.getElementById(idSub)
        if (!elVar || !elSub) return

        elVar.textContent = neg
            ? '(' + formatK(Math.abs(v)) + ')'
            : formatK(v)

        elVar.style.color = neg ? '#c0392b' : '#2e7d32'

        elSub.textContent =
            `${label} A: ${formatK(a)} · ${label} B: ${formatK(b)} · ${pct.toFixed(1)}%`
    }

    setKpi('plCompRevVar',  'plCompRevSub',  revA, revB, 'Revenue')
    setKpi('plCompGPVar',   'plCompGPSub',   gpA,  gpB,  'Gross Profit')
    setKpi('plCompNPVar',   'plCompNPSub',   npA,  npB,  'Net Profit')
    setKpi('plCompOpexVar', 'plCompOpexSub', opA,  opB,  'Operating Expenses')
}

// ==========================================================
// START APP
// ==========================================================

module.exports = app;
