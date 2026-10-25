document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    const transfer = tab.dataset.kind === 'transfer';
    document.getElementById('action').value = tab.dataset.kind;
    document.querySelector('.target-field')?.classList.toggle('hidden', !transfer);
    const target = document.querySelector('[name="target_account_id"]');
    if (target) target.required = transfer;
    document.querySelector('#transaction-form button[type="submit"], #transaction-form button:not([type])').innerHTML = `${tab.dataset.kind[0].toUpperCase()}${tab.dataset.kind.slice(1)} <span>→</span>`;
  });
});

function showNotice(message, kind = 'success') {
  let area = document.querySelector('.alerts');
  if (!area) {
    area = document.createElement('div');
    area.className = 'alerts';
    document.querySelector('.content')?.prepend(area);
  }
  const notice = document.createElement('div');
  notice.className = `alert ${kind}`;
  notice.setAttribute('role', 'status');
  notice.append(document.createTextNode(message));
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss message');
  close.addEventListener('click', () => notice.remove());
  notice.append(close); area.prepend(notice);
  window.setTimeout(() => notice.remove(), 5000);
}

function cell(row, text, className = '') {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  row.append(td); return td;
}

// Search customers as the user types, without navigating away from the page.
const customerSearch = document.querySelector('.search input[name="q"]');
if (customerSearch) {
  let searchTimer;
  let activeSearch;
  async function loadCustomers() {
    activeSearch?.abort(); activeSearch = new AbortController();
    try {
      const response = await fetch(`/api/customers?q=${encodeURIComponent(customerSearch.value)}`, { signal: activeSearch.signal });
      if (!response.ok) throw new Error('Search failed');
      const customers = await response.json();
      const body = document.querySelector('.table-wrap tbody');
      if (!body) return;
      body.replaceChildren();
      customers.forEach((customer) => {
        const tr = document.createElement('tr');
        const person = document.createElement('td');
        const avatar = document.createElement('span'); avatar.className = 'avatar table-avatar'; avatar.textContent = customer.full_name.slice(0, 1).toUpperCase();
        const name = document.createElement('span'); name.className = 'cell-main'; name.append(document.createTextNode(customer.full_name));
        const id = document.createElement('small'); id.textContent = `ID #${customer.customer_id}`; name.append(id); person.append(avatar, name); tr.append(person);
        const contact = document.createElement('td'); contact.append(document.createTextNode(customer.email));
        const phone = document.createElement('small'); phone.className = 'subline'; phone.textContent = customer.phone; contact.append(phone); tr.append(contact);
        cell(tr, customer.address);
        const accounts = document.createElement('td'); const count = document.createElement('span'); count.className = 'count'; count.textContent = customer.account_count; accounts.append(count); tr.append(accounts);
        cell(tr, customer.created_at); body.append(tr);
      });
      if (!customers.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 5; td.className = 'empty'; td.textContent = 'No customers match your search.'; tr.append(td); body.append(tr); }
      const total = document.querySelector('.section-row .count'); if (total) total.textContent = customers.length;
    } catch (error) { if (error.name !== 'AbortError') showNotice('Could not refresh customer results.', 'error'); }
  }
  customerSearch.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadCustomers, 220); });
  customerSearch.closest('form')?.addEventListener('submit', (event) => { event.preventDefault(); loadCustomers(); });
}

const transactionForm = document.getElementById('transaction-form');
if (transactionForm) {
  const accountPicker = transactionForm.querySelector('[name="account_id"]');
  let balancePreview = document.getElementById('balance-preview');
  if (!balancePreview && accountPicker) {
    balancePreview = document.createElement('small'); balancePreview.className = 'balance-preview';
    accountPicker.insertAdjacentElement('afterend', balancePreview);
  }
  function showSelectedBalance() {
    const option = accountPicker?.selectedOptions[0];
    if (!balancePreview || !option || !option.value) { if (balancePreview) balancePreview.textContent = 'Select an account to see its balance.'; return; }
    const match = option.textContent.match(/₹([\d,]+\.\d{2})/);
    balancePreview.textContent = match ? `Available balance: ₹${match[1]}` : 'Selected account';
  }
  accountPicker?.addEventListener('change', showSelectedBalance); showSelectedBalance();

  transactionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = transactionForm.querySelector('button[type="submit"], button:not([type])');
    const original = submit?.textContent;
    if (submit) { submit.disabled = true; submit.textContent = 'Processing…'; }
    try {
      const response = await fetch(transactionForm.action || window.location.href, {
        method: 'POST', body: new FormData(transactionForm),
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Transaction could not be completed.');
      Object.entries(result.balances || {}).forEach(([id, balance]) => {
        transactionForm.querySelectorAll('select option').forEach((option) => {
          if (option.value !== id) return;
          if (!option.dataset.label) option.dataset.label = option.textContent.replace(/\s·\s₹[\d,]+\.\d{2}$/, '');
          option.textContent = `${option.dataset.label} · ₹${Number(balance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        });
      });
      transactionForm.querySelector('[name="amount"]').value = '';
      transactionForm.querySelector('[name="note"]').value = '';
      showSelectedBalance(); showNotice(result.message);
      await refreshActivity();
    } catch (error) { showNotice(error.message || 'Could not complete the transaction.', 'error'); }
    finally { if (submit) { submit.disabled = false; submit.textContent = original || 'Confirm'; } }
  });
}

async function refreshActivity() {
  try {
    const [activityResponse, dashboardResponse] = await Promise.all([fetch('/api/transactions/recent'), fetch('/api/dashboard')]);
    if (activityResponse.ok) {
      const rows = await activityResponse.json();
      const body = document.querySelector('.table-wrap tbody');
      if (body) {
        body.replaceChildren();
        rows.forEach((item) => {
          const tr = document.createElement('tr');
          const typeCell = document.createElement('td');
          const icon = document.createElement('span');
          const incoming = ['Deposit', 'Transfer In'].includes(item.transaction_type);
          icon.className = `type-icon ${incoming ? 'in' : 'out'}`; icon.textContent = incoming ? '↓' : '↑';
          const label = document.createElement('span'); label.className = 'cell-main'; label.append(document.createTextNode(item.transaction_type));
          const note = document.createElement('small'); note.textContent = item.note || '—'; label.append(note); typeCell.append(icon, label); tr.append(typeCell);
          cell(tr, item.full_name); cell(tr, item.account_number, 'mono'); cell(tr, item.created_at);
          cell(tr, `${incoming ? '+' : '−'}₹${Number(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, `right amount ${incoming ? 'positive' : ''}`);
          body.append(tr);
        });
        if (!rows.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 5; td.className = 'empty'; td.textContent = 'No transactions recorded yet.'; tr.append(td); body.append(tr); }
      }
    }
    if (dashboardResponse.ok) {
      const stats = await dashboardResponse.json();
      const values = [stats.customers, stats.accounts, `₹${Number(stats.deposits).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, stats.transactions];
      document.querySelectorAll('.stat-card strong').forEach((item, index) => { if (values[index] !== undefined) item.textContent = values[index]; });
    }
  } catch (_) { /* The saved transaction remains successful if a live refresh is unavailable. */ }
}
