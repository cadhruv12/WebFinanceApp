const express  = require('express')
const sqlite3  = require('sqlite3').verbose()
const csv      = require('csv-parser')
const chokidar = require('chokidar')
const fs       = require('fs')
const path     = require('path')

const app  = express()
const PORT = 3000

app.use(express.static('public'))

// ───────────────────────────────────────────────────────────
// DATABASE INITIALIZATION
// ───────────────────────────────────────────────────────────
const db = new sqlite3.Database('./finance.db')

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS sales (
        company TEXT, division TEXT, month TEXT, year TEXT,
        customer TEXT, brand TEXT, salesman TEXT, net_sales REAL
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS tb (
        company TEXT, period TEXT, month TEXT, year TEXT,
        sort TEXT, account_no TEXT, account_name TEXT,
        opening REAL, debit REAL, credit REAL, balance REAL
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS loaded_files (
        filepath TEXT PRIMARY KEY, loaded_at TEXT
    )`)
})

// ───────────────────────────────────────────────────────────
// FILE LOAD TRACKING
// ───────────────────────────────────────────────────────────
function isLoaded(fp, cb) {
    db.get(`SELECT filepath FROM loaded_files WHERE filepath = ?`, [fp], (e, r) => cb(!!r))
}
function markLoaded(fp) {
    db.run(`INSERT OR IGNORE INTO loaded_files VALUES (?, ?)`, [fp, new Date().toISOString()])
}

// ───────────────────────────────────────────────────────────
// MONTH PARSING
// ───────────────────────────────────────────────────────────
const MONTH_MAP = {
    jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun',
    jul:'Jul',aug:'Aug',sep:'Sep',oct:'Oct',nov:'Nov',dec:'Dec',
    january:'Jan',february:'Feb',march:'Mar',april:'Apr',june:'Jun',
    july:'Jul',august:'Aug',september:'Sep',october:'Oct',november:'Nov',december:'Dec'
}

function parseMonthYear(str) {
    str = (str || '').trim()
    const m = str.match(/^([A-Za-z]+)(\d{2,4})$/)
    if (m) {
        const mo = MONTH_MAP[m[1].toLowerCase()]
        const yr = m[2].length === 2 ? '20' + m[2] : m[2]
        if (mo) return { month: mo, year: yr }
    }
    const m2 = str.match(/^(\d{4})-(\d{2})$/)
    if (m2) {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        return { month: months[parseInt(m2[2]) - 1], year: m2[1] }
    }
    return { month: str, year: '' }
}

function parseTBFilename(filename) {
    const base  = path.basename(filename, path.extname(filename))
    const parts = base.split('_')
    const company = parts[0]
    let periodStr = ''
    for (let i = 1; i < parts.length; i++) {
        if (/^[A-Za-z]+\d+$/.test(parts[i])) { periodStr = parts[i]; break }
    }
    const { month, year } = parseMonthYear(periodStr)
    return { company, month, year, period: periodStr }
}

// ───────────────────────────────────────────────────────────
// PROCESS SALES FILE
// ───────────────────────────────────────────────────────────
function processSalesFile(filePath, company) {
    isLoaded(filePath, already => {
        if (already) { console.log('Skip:', path.basename(filePath)); return }
        const rows = []
        fs.createReadStream(filePath).pipe(csv())
            .on('data', r => rows.push(r))
            .on('end', () => {
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION')
                    const stmt = db.prepare(`INSERT INTO sales VALUES (?,?,?,?,?,?,?,?)`)
                    rows.forEach(r => stmt.run([
                        company, r['Division'] || '', r['Month'] || '', String(r['Year'] || ''),
                        r['Cust Name'] || '', r['Brand Name'] || '', r['Salesman Name'] || '',
                        parseFloat(r['Net Sales'] || r['Net'] || 0)
                    ]))
                    stmt.finalize()
                    db.run('COMMIT')
                })
                markLoaded(filePath)
                console.log('Loaded Sales:', path.basename(filePath), rows.length, 'rows')
            })
    })
}

// ───────────────────────────────────────────────────────────
// PROCESS TB FILE
// ───────────────────────────────────────────────────────────
function processTBFile(filePath) {
    isLoaded(filePath, already => {
        if (already) { console.log('Skip:', path.basename(filePath)); return }
        const { company, month, year, period } = parseTBFilename(filePath)
        const rows = []
        fs.createReadStream(filePath).pipe(csv())
            .on('data', r => rows.push(r))
            .on('end', () => {
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION')
                    const stmt = db.prepare(`INSERT INTO tb VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
                    rows.forEach(r => {
                        const keys    = Object.keys(r)
                        const sortKey = keys.find(k => k.replace(/^\uFEFF/, '').trim().toUpperCase() === 'SORT') || keys[0]
                        const sort    = (r[sortKey] || '').trim()
                        if (!sort || sort === '-') return
                        stmt.run([
                            company, period, month, year, sort,
                            (r['ACCOUNT NO'] || '').trim(),
                            (r['ACCOUNT NAME'] || '').trim(),
                            parseFloat(r[' OPENING BALANCE '] || r['OPENING BALANCE'] || 0),
                            parseFloat(r[' DEBIT AMOUNT ']    || r['DEBIT AMOUNT']    || 0),
                            parseFloat(r[' CREDIT AMOUNT ']   || r['CREDIT AMOUNT']   || 0),
                            parseFloat(r[' BALANCE ']         || r['BALANCE']         || 0)
                        ])
                    })
                    stmt.finalize()
                    db.run('COMMIT')
                })
                markLoaded(filePath)
                console.log('Loaded TB:', path.basename(filePath), '->', company, month, year, rows.length, 'rows')
            })
    })
}

// ───────────────────────────────────────────────────────────
// WATCHER
// ───────────────────────────────────────────────────────────
const dataPath = path.join(__dirname, 'data')
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath)

chokidar.watch(dataPath, { persistent: true, ignoreInitial: false })
    .on('add', filePath => {
        if (!filePath.endsWith('.csv')) return
        const rel   = path.relative(dataPath, filePath)
        const parts = rel.split(path.sep)
        if (parts.length < 3) return
        const folder = parts[1].toLowerCase()
        if      (folder === 'sales') processSalesFile(filePath, parts[0])
        else if (folder === 'tb')    processTBFile(filePath)
    })

// ───────────────────────────────────────────────────────────
// EXISTING ENDPOINTS
// ───────────────────────────────────────────────────────────
app.get('/sales', (req, res) => {
    db.all(`SELECT * FROM sales`, [], (e, rows) => res.json(rows))
})

const PL_CATS = [
    'Sales of Goods','Cost of Sales','Gain on foreign exchange',
    'Other Income','Finance Cost','Distribution Costs','Administrative expenses'
]

app.get('/pl', (req, res) => {
    const ph = PL_CATS.map(() => '?').join(',')
    db.all(
        `SELECT sort, account_no, account_name, company, month, year,
                SUM(opening) as opening, SUM(debit) as debit,
                SUM(credit) as credit, SUM(balance) as balance
         FROM tb WHERE sort IN (${ph})
         GROUP BY sort, account_no, account_name, company, month, year
         ORDER BY account_no`,
        PL_CATS,
        (e, rows) => res.json(rows)
    )
})

// ───────────────────────────────────────────────────────────
// NEW: PERIOD COMPARISON HELPERS
// ───────────────────────────────────────────────────────────
function parsePeriod(periodStr) {
    const [year, mm] = periodStr.split('-')
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return { month: months[parseInt(mm) - 1], year }
}

function getPLForPeriod(month, year) {
    return new Promise((resolve, reject) => {
        const ph = PL_CATS.map(() => '?').join(',')
        db.all(
            `SELECT sort, SUM(balance) as balance
             FROM tb
             WHERE sort IN (${ph}) AND month = ? AND year = ?
             GROUP BY sort`,
            [...PL_CATS, month, year],
            (err, rows) => {
                if (err) return reject(err)
                const out = {}
                rows.forEach(r => out[r.sort] = r.balance)
                resolve(out)
            }
        )
    })
}

// ───────────────────────────────────────────────────────────
// NEW: PERIOD A vs PERIOD B COMPARISON ENDPOINT
// ───────────────────────────────────────────────────────────
app.get('/pl-compare', async (req, res) => {
    try {
        const { periodA, periodB } = req.query
        if (!periodA || !periodB) {
            return res.status(400).json({ error: 'periodA and periodB are required' })
        }

        const pA = parsePeriod(periodA)
        const pB = parsePeriod(periodB)

        const plA = await getPLForPeriod(pA.month, pA.year)
        const plB = await getPLForPeriod(pB.month, pB.year)

        const accounts = new Set([...Object.keys(plA), ...Object.keys(plB)])
        const result = []

        accounts.forEach(acc => {
            const a = plA[acc] || 0
            const b = plB[acc] || 0
            const variance = a - b
            const percent = b !== 0 ? variance / b : null

            result.push({
                account: acc,
                periodA: a,
                periodB: b,
                variance,
                percent,
                existsInA: plA[acc] !== undefined,
                existsInB: plB[acc] !== undefined
            })
        })

        res.json({ periodA, periodB, data: result })

    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

// ───────────────────────────────────────────────────────────
// START SERVER
// ───────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`\nFinance Dashboard → http://localhost:${PORT}\n`))