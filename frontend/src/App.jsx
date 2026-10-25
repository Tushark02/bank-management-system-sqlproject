import { useEffect, useMemo, useState } from 'react';

const NAV = [
  ['overview', 'Overview', '◫'], ['customers', 'Customers', '♙'],
  ['accounts', 'Accounts', '▣'], ['transactions', 'Transactions', '↔'],
  ['branches', 'Branches', '⌂'], ['employees', 'Team', '♧'], ['loans', 'Loans', '₹'],
  ['schema', 'Database', '⌘'],
];
const currency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SCHEMA_TABLES = [
  { name:'customers', purpose:'People who bank with HDLC Bank', fields:[['customer_id','INT','PK'],['full_name','VARCHAR(120)'],['email','VARCHAR(160)','UNIQUE'],['phone','VARCHAR(20)'],['address','VARCHAR(255)'],['created_at','TIMESTAMP']], rules:['Primary key: customer_id','Unique: email','Referenced by accounts and loans'] },
  { name:'accounts', purpose:'Customer accounts and current balances', fields:[['account_id','INT','PK'],['account_number','CHAR(12)','UNIQUE'],['customer_id','INT','FK'],['branch_id','INT NULL','FK'],['account_type','ENUM'],['balance','DECIMAL(12,2)','CHECK ≥ 0'],['status','ENUM'],['opened_at','TIMESTAMP']], rules:['FK → customers.customer_id','FK → branches.branch_id (nullable for older records)','Balance must be zero or greater'] },
  { name:'transactions', purpose:'Ledger entries for account activity', fields:[['transaction_id','BIGINT','PK'],['account_id','INT','FK'],['related_account_id','INT NULL','FK'],['transaction_type','ENUM'],['amount','DECIMAL(12,2)','CHECK > 0'],['note','VARCHAR(255)'],['created_at','TIMESTAMP']], rules:['FK → accounts.account_id','Optional related account for transfers','Amount must be greater than zero'] },
  { name:'branches', purpose:'Bank locations and routing details', fields:[['branch_id','INT','PK'],['branch_name','VARCHAR(120)'],['city','VARCHAR(100)'],['ifsc_code','VARCHAR(11)','UNIQUE']], rules:['Primary key: branch_id','Unique: ifsc_code','Referenced by accounts and employees'] },
  { name:'employees', purpose:'Staff members assigned to a branch', fields:[['employee_id','INT','PK'],['branch_id','INT','FK'],['name','VARCHAR(120)'],['designation','VARCHAR(100)'],['salary','DECIMAL(12,2)']], rules:['FK → branches.branch_id','Branch deletion is restricted while employees reference it'] },
  { name:'loans', purpose:'Loans issued to customers', fields:[['loan_id','INT','PK'],['customer_id','INT','FK'],['amount','DECIMAL(12,2)'],['loan_type','VARCHAR(60)'],['interest_rate','DECIMAL(5,2)']], rules:['FK → customers.customer_id','Customer deletion is restricted while loans reference it'] },
];
const SCHEMA_RELATIONS = [
  ['customers','accounts','1 → many','One customer can own multiple accounts.'],
  ['branches','accounts','1 → many','A branch can service multiple accounts.'],
  ['branches','employees','1 → many','A branch can have multiple employees.'],
  ['customers','loans','1 → many','A customer can have multiple loans.'],
  ['accounts','transactions','1 → many','An account has multiple ledger entries.'],
  ['accounts','transactions.related_account_id','optional link','A transfer can reference its other account.'],
];

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'The request could not be completed.');
  return data;
}

function App() {
  const [page, setPage] = useState('overview');
  const [stats, setStats] = useState({ customers: 0, accounts: 0, deposits: 0, transactions: 0 });
  const [customers, setCustomers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loans, setLoans] = useState([]);
  const [activity, setActivity] = useState([]);
  const [query, setQuery] = useState('');
  const [listQuery, setListQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [notice, setNotice] = useState(null);
  const [history, setHistory] = useState(null);
  const [portal, setPortal] = useState(null);
  const [transactionMode, setTransactionMode] = useState('deposit');
  const [transactionAccount, setTransactionAccount] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');

  function moveBackground(event) {
    const x = `${(event.clientX / window.innerWidth) * 100}%`;
    const y = `${(event.clientY / window.innerHeight) * 100}%`;
    event.currentTarget.style.setProperty('--pointer-x', x);
    event.currentTarget.style.setProperty('--pointer-y', y);
  }
  function resetBackground(event) {
    event.currentTarget.style.setProperty('--pointer-x', '52%');
    event.currentTarget.style.setProperty('--pointer-y', '22%');
  }

  async function loadData(customerQuery = query, silent = false) {
    setRefreshing(true);
    try {
      const [nextStats, nextCustomers, nextBranches, nextAccounts, nextEmployees, nextLoans, nextActivity] = await Promise.all([
        api('/dashboard'), api(`/customers?q=${encodeURIComponent(customerQuery)}`), api('/branches'),
        api('/accounts'), api('/employees'), api('/loans'), api('/transactions/recent'),
      ]);
      setStats(nextStats); setCustomers(nextCustomers); setBranches(nextBranches); setAccounts(nextAccounts);
      setEmployees(nextEmployees); setLoans(nextLoans); setActivity(nextActivity);
      setOnline(true); setLastUpdated(new Date());
    } catch (error) { setOnline(false); if (!silent) setNotice({ kind: 'error', text: error.message }); }
    finally { setRefreshing(false); }
  }

  useEffect(() => { loadData(''); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => loadData(page === 'customers' ? query : '', true), 30000);
    return () => window.clearInterval(timer);
  }, [page, query]);
  useEffect(() => {
    if (page !== 'customers') return;
    const timer = window.setTimeout(async () => {
      try { setCustomers(await api(`/customers?q=${encodeURIComponent(query)}`)); }
      catch (error) { setNotice({ kind: 'error', text: error.message }); }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, page]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const accountById = useMemo(() => Object.fromEntries(accounts.map((item) => [item.account_id, item])), [accounts]);
  const contains = (values) => values.some((value) => String(value ?? '').toLowerCase().includes(listQuery.trim().toLowerCase()));
  const visibleBranches = branches.filter((b) => contains([b.branch_name,b.city,b.ifsc_code]));
  const visibleAccounts = accounts.filter((a) => contains([a.account_number,a.full_name,a.branch_name,a.account_type]));
  const visibleEmployees = employees.filter((e) => contains([e.name,e.designation,e.branch_name]));
  const visibleLoans = loans.filter((l) => contains([l.full_name,l.loan_type,l.loan_id]));
  const visibleActivity = activity.filter((t) => contains([t.transaction_type,t.full_name,t.account_number,t.note]));
  const titles = { overview: 'Your banking overview', customers: 'Customers', accounts: 'Accounts', transactions: 'Transactions', branches: 'Branches', employees: 'Employees', loans: 'Loans' };

  function goToPage(nextPage) {
    if (nextPage === page) return;
    setPage(nextPage);
    setListQuery('');
    setNotice(null);
    setPortal({ page: nextPage, token: Date.now() });
  }

  async function submitForm(event, endpoint, after = () => {}) {
    event.preventDefault(); setBusy(true);
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      setNotice({ kind: 'success', text: result.message || 'Saved successfully.' });
      form.reset(); after(); await loadData(page === 'customers' ? query : '');
    } catch (error) { setNotice({ kind: 'error', text: error.message }); }
    finally { setBusy(false); }
  }

  async function makeTransaction(event) {
    event.preventDefault(); setBusy(true);
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.action = transactionMode;
    try {
      const result = await api('/transactions', { method: 'POST', body: JSON.stringify(payload) });
      setNotice({ kind: 'success', text: result.message }); form.reset(); setTransactionAccount(''); setTransactionAmount('');
      await loadData(page === 'customers' ? query : '');
    } catch (error) { setNotice({ kind: 'error', text: error.message }); }
    finally { setBusy(false); }
  }

  async function showHistory(account) {
    try { setHistory({ account, rows: await api(`/accounts/${account.account_id}/history`) }); }
    catch (error) { setNotice({ kind: 'error', text: error.message }); }
  }

  async function assignBranch(accountId, branchId) {
    try {
      await api(`/accounts/${accountId}/branch`, { method: 'PATCH', body: JSON.stringify({ branch_id: branchId }) });
      setNotice({ kind: 'success', text: 'Account branch updated.' }); await loadData();
    } catch (error) { setNotice({ kind: 'error', text: error.message }); }
  }

  return <div className="app-shell" onPointerMove={moveBackground} onPointerLeave={resetBackground}>
    <div className="ambient-backdrop" aria-hidden="true" />
    {portal && <div key={portal.token} className={`portal-transition portal-${portal.page}`} aria-hidden="true" onAnimationEnd={(event)=>{if(event.target===event.currentTarget)setPortal(null)}}><div className="portal-title"><span>JUMPING TO</span><strong>{portal.page==='overview'?'OVERVIEW':portal.page.toUpperCase()}</strong></div></div>}
    <header className="topbar">
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); goToPage('overview'); }}><span className="brand-mark">H</span><span>HDLC Bank<small>BANKING PORTAL</small></span></a>
      <nav className="nav-pills" aria-label="Main navigation">{NAV.map(([id, label, icon]) => <button key={id} className={`nav-link ${page === id ? 'active' : ''}`} onClick={() => goToPage(id)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="top-right"><span className={`status ${online?'online':'offline'}`}><i /> {online?'MySQL connected':'Connecting…'}</span><button className={`refresh-button ${refreshing?'spinning':''}`} onClick={()=>loadData(page==='customers'?query:'')} aria-label="Refresh data" title={lastUpdated?`Updated ${lastUpdated.toLocaleTimeString()}`:'Refresh data'}>⟳</button><span className="avatar">A</span></div>
    </header>

    <main className={`content page-animate view-${page}`} key={page}>
      {notice && <div className={`toast ${notice.kind}`} role="status">{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}
      {page === 'overview' && <>
        <section className="hero"><div className="hero-copy"><span className="eyebrow">HDLC BANK · BANKING OVERVIEW</span><h1>Banking,<br />made simple.</h1><p>A clear view of your customers, accounts, and activity.</p><button className="button light" onClick={() => goToPage('transactions')}>Make a transaction <span>↗</span></button></div><div className="hero-note"><i /> Your workspace at a glance</div></section>
        <div className="stats-grid">{[['Total customers',stats.customers,'♙','violet','Registered customers','customers'],['Active accounts',stats.accounts,'▣','blue','Across all account types','accounts'],['Total deposits',currency(stats.deposits),'₹','green','Combined account balance','accounts'],['Transactions',stats.transactions,'↔','amber','All-time transactions','transactions']].map(([label,value,icon,color,foot,destination])=><article className="stat-card interactive-stat" key={label} role="button" tabIndex="0" title={`Open ${destination}`} onClick={()=>goToPage(destination)} onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goToPage(destination)}}}><div className="stat-top"><span>{label}</span><span className={`stat-icon ${color}`}>{icon}</span></div><strong>{value}</strong><small>{foot} <span className="card-arrow">↗</span></small></article>)}</div>
        <ActivityChart items={activity} onSelect={()=>goToPage('transactions')} />
        <SectionHeading title="Recent activity" subtitle="Latest account movements" action={<button className="text-link" onClick={() => goToPage('transactions')}>View transactions →</button>} />
        <ActivityTable rows={visibleActivity} />
        <div className="quick-grid"><button className="quick-card" onClick={() => goToPage('customers')}><span className="quick-icon violet">＋</span><span><b>Add a customer</b><small>Register a new bank customer</small></span><i>→</i></button><button className="quick-card" onClick={() => goToPage('accounts')}><span className="quick-icon blue">▣</span><span><b>Open an account</b><small>Create a savings or current account</small></span><i>→</i></button></div>
      </>}
      {page !== 'overview' && <>
        <div className="page-heading"><div><div className="eyebrow">HDLC BANK · WORKSPACE</div><h1>{titles[page] || 'Database structure'}</h1><p>Manage your bank records with live updates.</p></div><span className="page-mark">{NAV.find((item) => item[0] === page)?.[2]}</span></div>
        {page === 'schema' && <DatabaseStructure />}
        {page === 'customers' && <>
          <SectionHeading title={`Customer directory · ${customers.length}`} subtitle="Search updates as you type" action={<input className="search-box" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, or phone" />} />
          <DataTable headers={['CUSTOMER','CONTACT','ADDRESS','ACCOUNTS','JOINED']} empty="No customers found."><tbody>{customers.map((c)=><tr key={c.customer_id}><td><span className="avatar table-avatar">{c.full_name[0]?.toUpperCase()}</span><span className="cell-main">{c.full_name}<small>ID #{c.customer_id}</small></span></td><td>{c.email}<small className="subline">{c.phone}</small></td><td>{c.address}</td><td>{c.account_count}</td><td>{c.created_at}</td></tr>)}</tbody></DataTable>
          <Panel title="Add a customer" subtitle="Enter the customer’s contact details"><form className="form-grid" onSubmit={(e)=>submitForm(e,'/customers')}><Field label="Full name" name="full_name" required placeholder="e.g. Aanya Sharma"/><Field label="Email address" name="email" type="email" required placeholder="name@example.com"/><Field label="Phone number" name="phone" required placeholder="+91 98765 43210"/><Field label="Address" name="address" required placeholder="Street, city, postal code"/><FormAction busy={busy} label="Save customer"/></form></Panel>
        </>}
        {page === 'branches' && <>
          <SectionHeading title={`Branches · ${visibleBranches.length}`} subtitle="Locations, IFSC codes, and assigned teams" action={<input className="search-box" value={listQuery} onChange={(e)=>setListQuery(e.target.value)} placeholder="Filter branches…"/>} />
          <DataTable headers={['BRANCH','CITY','IFSC CODE','ACCOUNTS','EMPLOYEES']} empty="No branches match your search."><tbody>{visibleBranches.map((b)=><tr key={b.branch_id}><td className="cell-main">{b.branch_name}</td><td>{b.city}</td><td className="mono">{b.ifsc_code}</td><td>{b.account_count}</td><td>{b.employee_count}</td></tr>)}</tbody></DataTable>
          <Panel title="Add a branch" subtitle="IFSC code must contain 11 characters"><form className="form-grid" onSubmit={(e)=>submitForm(e,'/branches')}><Field label="Branch name" name="branch_name" required/><Field label="City" name="city" required/><Field label="IFSC code" name="ifsc_code" required maxLength="11"/><FormAction busy={busy} label="Save branch"/></form></Panel>
        </>}
        {page === 'accounts' && <>
          <SectionHeading title={`Accounts · ${visibleAccounts.length}`} subtitle="Balances, ownership, and branch assignments" action={<input className="search-box" value={listQuery} onChange={(e)=>setListQuery(e.target.value)} placeholder="Filter accounts…"/>} />
          <DataTable headers={['ACCOUNT','ACCOUNT HOLDER','TYPE','BRANCH','STATUS','BALANCE','HISTORY']} empty="No accounts match your search."><tbody>{visibleAccounts.map((a)=><tr key={a.account_id}><td className="mono">{a.account_number}</td><td>{a.full_name}</td><td>{a.account_type}</td><td><select className="inline-select" value={a.branch_id || ''} onChange={(e)=>assignBranch(a.account_id,e.target.value)}><option value="" disabled>Select branch</option>{branches.map((b)=><option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}</select></td><td><span className="badge active">{a.status}</span></td><td className="right amount">{currency(a.balance)}</td><td><button className="text-link" onClick={()=>showHistory(a)}>View →</button></td></tr>)}</tbody></DataTable>
          <Panel title="Open a new account" subtitle="Select an existing customer and branch"><form className="form-grid" onSubmit={(e)=>submitForm(e,'/accounts')}><SelectField label="Customer" name="customer_id" options={customers.map((c)=>[c.customer_id,c.full_name])} required/><SelectField label="Branch" name="branch_id" options={branches.map((b)=>[b.branch_id,`${b.branch_name} · ${b.city}`])} required/><SelectField label="Account type" name="account_type" options={ [['Savings','Savings'],['Current','Current']] } required/><Field label="Opening deposit (optional)" name="opening_balance" type="number" min="0" step="0.01" placeholder="0.00"/><FormAction busy={busy} label="Open account"/></form>{(!customers.length||!branches.length)&&<p className="form-hint">Add at least one customer and one branch first.</p>}</Panel>
        </>}
        {page === 'transactions' && <>
          <Panel title="Make a transaction" subtitle="Balance changes and ledger entries are saved together"><div className="tabs">{['deposit','withdraw','transfer'].map((mode)=><button type="button" key={mode} className={transactionMode===mode?'selected':''} onClick={()=>setTransactionMode(mode)}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}</div><form className="form-grid" onSubmit={makeTransaction}><SelectField label="From account" name="account_id" options={accounts.filter((a)=>a.status==='Active').map((a)=>[a.account_id,`${a.account_number} · ${a.full_name} · ${currency(a.balance)}`])} required value={transactionAccount} onChange={(e)=>setTransactionAccount(e.target.value)}/>{transactionMode==='transfer'&&<SelectField label="To account" name="target_account_id" options={accounts.filter((a)=>a.status==='Active'&&String(a.account_id)!==String(transactionAccount)).map((a)=>[a.account_id,`${a.account_number} · ${a.full_name}`])} required/>}<Field label="Amount (₹)" name="amount" type="number" min="0.01" step="0.01" required value={transactionAmount} onChange={(e)=>setTransactionAmount(e.target.value)}/><Field label="Note (optional)" name="note"/><FormAction busy={busy} label={`Confirm ${transactionMode}`}/></form>{transactionAccount&&<p className={`form-hint ${['withdraw','transfer'].includes(transactionMode)&&Number(transactionAmount)>Number(accountById[transactionAccount]?.balance)?'warning':''}`}>Available balance: {currency(accountById[transactionAccount]?.balance)}{transactionAmount&&<span> · {transactionMode==='deposit'?'After deposit':transactionMode==='withdraw'?'After withdrawal':'After transfer'}: {currency(Number(accountById[transactionAccount]?.balance||0)+(transactionMode==='deposit'?1:-1)*Number(transactionAmount))}</span>}</p>}</Panel>
          <SectionHeading title="Recent transactions" subtitle="Latest ledger activity" action={<input className="search-box" value={listQuery} onChange={(e)=>setListQuery(e.target.value)} placeholder="Filter activity…"/>}/><ActivityTable rows={visibleActivity}/>
        </>}
        {page === 'employees' && <>
          <SectionHeading title={`Team directory · ${visibleEmployees.length}`} subtitle="Employees assigned to bank branches" action={<input className="search-box" value={listQuery} onChange={(e)=>setListQuery(e.target.value)} placeholder="Filter team…"/>} />
          <DataTable headers={['EMPLOYEE','DESIGNATION','BRANCH','SALARY']} empty="No employees match your search."><tbody>{visibleEmployees.map((e)=><tr key={e.employee_id}><td>{e.name}<small className="subline">ID #{e.employee_id}</small></td><td>{e.designation}</td><td>{e.branch_name}</td><td className="right amount">{currency(e.salary)}</td></tr>)}</tbody></DataTable>
          <Panel title="Add an employee" subtitle="Every employee must belong to a branch"><form className="form-grid" onSubmit={(e)=>submitForm(e,'/employees')}><Field label="Full name" name="name" required/><Field label="Designation" name="designation" required/><SelectField label="Branch" name="branch_id" options={branches.map((b)=>[b.branch_id,b.branch_name])} required/><Field label="Salary (₹)" name="salary" type="number" min="0" step="0.01" required/><FormAction busy={busy} label="Save employee"/></form></Panel>
        </>}
        {page === 'loans' && <>
          <SectionHeading title={`Loans · ${visibleLoans.length}`} subtitle="Loans recorded for registered customers" action={<input className="search-box" value={listQuery} onChange={(e)=>setListQuery(e.target.value)} placeholder="Filter loans…"/>} />
          <DataTable headers={['LOAN','CUSTOMER','TYPE','INTEREST RATE','AMOUNT']} empty="No loans match your search."><tbody>{visibleLoans.map((l)=><tr key={l.loan_id}><td className="mono">#{l.loan_id}</td><td>{l.full_name}</td><td>{l.loan_type}</td><td>{Number(l.interest_rate).toFixed(2)}%</td><td className="right amount">{currency(l.amount)}</td></tr>)}</tbody></DataTable>
          <Panel title="Record a loan" subtitle="Connect the loan to an existing customer"><form className="form-grid" onSubmit={(e)=>submitForm(e,'/loans')}><SelectField label="Customer" name="customer_id" options={customers.map((c)=>[c.customer_id,c.full_name])} required/><Field label="Loan type" name="loan_type" required placeholder="Home, personal, education"/><Field label="Loan amount (₹)" name="amount" type="number" min="0.01" step="0.01" required/><Field label="Interest rate (%)" name="interest_rate" type="number" min="0" max="100" step="0.01" required/><FormAction busy={busy} label="Save loan"/></form></Panel>
        </>}
      </>}
      <footer>HDLC Bank <span>·</span> Educational RDBMS demonstration</footer>
    </main>
    {history && <div className="overlay" onMouseDown={(e)=>{if(e.target===e.currentTarget)setHistory(null)}}><section className="history-modal"><button className="modal-close" onClick={()=>setHistory(null)}>×</button><span className="eyebrow">ACCOUNT LEDGER</span><h2>{history.account.account_number}</h2><p>{history.account.full_name} · Current balance {currency(history.account.balance)}</p><ActivityTable rows={history.rows.map((r)=>({...r,full_name:history.account.full_name,account_number:history.account.account_number}))}/></section></div>}
  </div>;
}

function DatabaseStructure() {
  const [selected, setSelected] = useState('accounts');
  const active = SCHEMA_TABLES.find((table) => table.name === selected) || SCHEMA_TABLES[0];
  return <div className="database-page">
    <div className="schema-summary"><article><strong>6</strong><span>relational tables</span></article><article><strong>6</strong><span>foreign-key links</span></article><article><strong>3</strong><span>unique constraints</span></article><article><strong>2</strong><span>check constraints</span></article></div>
    <section className="schema-panel"><div className="schema-heading"><div><h2>Relational schema</h2><p>Select a table to inspect its columns, keys, and rules.</p></div><span className="schema-database">MySQL · InnoDB</span></div>
      <div className="schema-grid">{SCHEMA_TABLES.map((table) => <button type="button" key={table.name} className={`schema-table ${selected===table.name?'selected':''}`} onClick={()=>setSelected(table.name)}><div className="schema-table-head"><span className="table-glyph">▤</span><span><b>{table.name}</b><small>{table.purpose}</small></span><span className="field-count">{table.fields.length}</span></div><div className="schema-fields">{table.fields.map(([name,type,tag])=><div className="schema-field" key={name}><span>{name}</span><small>{type}</small>{tag&&<em className={`key-tag ${tag.startsWith('CHECK')?'check':tag.toLowerCase()}`}>{tag}</em>}</div>)}</div></button>)}</div>
      <div className="schema-detail"><div className="detail-title"><span className="table-glyph">▤</span><div><span className="eyebrow">TABLE DETAILS</span><h3>{active.name}</h3></div></div><ul>{active.rules.map((rule)=><li key={rule}><span>✓</span>{rule}</li>)}</ul></div>
    </section>
    <section className="relationships-panel"><div className="schema-heading"><div><h2>Relationships</h2><p>Foreign keys preserve valid links between records.</p></div><span className="relationship-count">{SCHEMA_RELATIONS.length} links</span></div><div className="relationship-list">{SCHEMA_RELATIONS.map(([from,to,cardinality,description])=><button type="button" className="relationship-row" key={`${from}-${to}`} onClick={()=>setSelected(from==='accounts'?'accounts':from)}><span className="relation-table">{from}</span><span className="relation-line"><i/></span><span className="relation-cardinality">{cardinality}</span><span className="relation-line"><i/></span><span className="relation-table">{to}</span><small>{description}</small></button>)}</div></section>
    <div className="concept-grid"><article><b>PK</b><span><strong>Primary key</strong><small>Uniquely identifies each row.</small></span></article><article><b>FK</b><span><strong>Foreign key</strong><small>Connects a row to another table.</small></span></article><article><b>UNIQUE</b><span><strong>Unique constraint</strong><small>Prevents duplicate values.</small></span></article><article><b>CHECK</b><span><strong>Check constraint</strong><small>Rejects values outside a rule.</small></span></article></div>
  </div>;
}

function SectionHeading({ title, subtitle, action }) { return <div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>; }
function Panel({ title, subtitle, children }) { return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="panel-mark">✳</span></div>{children}</section>; }
function Field({ label, name, type='text', ...props }) { return <label className="field">{label}<input name={name} type={type} {...props}/></label>; }
function SelectField({ label, name, options, value, onChange, ...props }) { return <label className="field">{label}<select name={name} value={value} onChange={onChange} {...props}><option value="">Choose {label.toLowerCase()}</option>{options.map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></label>; }
function FormAction({ busy, label }) { return <div className="form-actions"><button className="button primary" disabled={busy}>{busy?'Saving…':label}<span>→</span></button></div>; }
function DataTable({ headers, empty, children }) { const hasRows = children?.props?.children?.length > 0; return <div className="table-wrap"><table><thead><tr>{headers.map((head)=><th key={head}>{head}</th>)}</tr></thead>{hasRows?children:<tbody><tr><td className="empty" colSpan={headers.length}>{empty}</td></tr></tbody>}</table></div>; }
function ActivityTable({ rows }) { return <DataTable headers={['TRANSACTION','CUSTOMER','ACCOUNT','DATE & TIME','AMOUNT']} empty="No activity yet."><tbody>{rows.map((row)=><tr key={row.transaction_id}><td><span className={`type-icon ${['Deposit','Transfer In'].includes(row.transaction_type)?'in':'out'}`}>{['Deposit','Transfer In'].includes(row.transaction_type)?'↓':'↑'}</span><span className="cell-main">{row.transaction_type}<small>{row.note||'—'}</small></span></td><td>{row.full_name}</td><td className="mono">{row.account_number}</td><td>{row.created_at}</td><td className={`right amount ${['Deposit','Transfer In'].includes(row.transaction_type)?'positive':''}`}>{['Deposit','Transfer In'].includes(row.transaction_type)?'+':'−'}{currency(row.amount)}</td></tr>)}</tbody></DataTable>; }
function ActivityChart({ items, onSelect }) {
  const points = [...items].slice(0, 8).reverse();
  const max = Math.max(1, ...points.map((item) => Number(item.amount || 0)));
  return <section className="activity-chart">
    <div className="chart-heading"><div><h2>Recent money movement</h2><p>Each bar is a recent ledger entry · select a bar to view all activity</p></div><div className="chart-legend"><span><i className="in-dot"/>Money in</span><span><i className="out-dot"/>Money out</span></div></div>
    <div className="chart-bars" role="list" aria-label="Recent transaction amounts">{points.length ? points.map((item) => {
      const incoming = ['Deposit','Transfer In'].includes(item.transaction_type);
      const height = Math.max(10, Math.round(Number(item.amount || 0) / max * 100));
      return <button type="button" role="listitem" key={item.transaction_id} className={`chart-bar ${incoming?'incoming':'outgoing'}`} style={{'--bar-height':`${height}%`}} title={`${item.transaction_type}: ${currency(item.amount)} · ${item.full_name}`} onClick={onSelect}><span className="bar-value">{currency(item.amount)}</span><span className="bar-column"><i/></span><small>{item.transaction_type.replace('Transfer ','')}</small></button>;
    }) : <p className="chart-empty">Record a transaction and its activity will appear here.</p>}</div>
  </section>;
}

export default App;
