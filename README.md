# Bank Management System (RDBMS Lab)

Demo bank name: **HDLC Bank**.

A small Flask + MySQL project for demonstrating relational database design and CRUD operations.

## Features

- Dashboard showing customer, account, and transaction totals
- Create and search customers
- Open savings/current accounts
- Deposit and withdraw with balance validation
- Transfer between accounts in one database transaction
- View each account's transaction history
- MySQL schema with primary keys, foreign keys, indexes, and constraints

This is an educational demo. It is not suitable for real banking or sensitive financial data.

## Requirements

- Python 3.10+
- MySQL Server 8+

## Setup

1. Create a MySQL database and load the schema:

   ```sql
   SOURCE schema.sql;
   ```

2. Create a `.env` file beside `app.py` (or set these environment variables):

   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_NAME=bank_management
   DB_USER=root
   DB_PASSWORD=your_mysql_password
   FLASK_SECRET_KEY=change-this-for-local-use
   ```

3. Install and run:

   ```bash
   python -m venv .venv
   # Windows: .venv\Scripts\activate
   # macOS/Linux: source .venv/bin/activate
   pip install -r requirements.txt
   python app.py
   ```

4. Open http://127.0.0.1:5000.

## Suggested lab demonstration

Create a customer, open two accounts, deposit into one, transfer to the other, then inspect the transaction history. The transfer uses a single MySQL transaction so the debit and credit succeed or fail together.

## React front end

The React interface is in `frontend/`. Keep the Flask API running, then open a second PowerShell window and run:

```powershell
cd C:\Users\tusha\Documents\Codex\2026-10-25\i-x20\frontend
npm install
npm run dev
```

Open the URL printed by Vite (normally http://127.0.0.1:5173). Use the Vite URL for the React interface; Flask remains the API on port 5000. Vite currently requires Node.js 20.19+ or 22.12+.
