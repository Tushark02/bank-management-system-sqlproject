import os
import secrets
from decimal import Decimal, InvalidOperation

import mysql.connector
from dotenv import load_dotenv
from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for
from mysql.connector import Error

load_dotenv()
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32))


def connect_db():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "bank_management"),
    )


def money(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2:
            raise ValueError
        return amount.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise ValueError("Enter an amount greater than zero with at most two decimal places.")


def account_number():
    return "10" + secrets.token_hex(5).upper()


def query(sql, params=(), one=False):
    db = connect_db()
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(sql, params)
        result = cursor.fetchone() if one else cursor.fetchall()
        return result
    finally:
        cursor.close()
        db.close()


@app.route("/")
def index():
    try:
        stats = query("""SELECT
            (SELECT COUNT(*) FROM customers) AS customers,
            (SELECT COUNT(*) FROM accounts WHERE status='Active') AS accounts,
            (SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE status='Active') AS deposits,
            (SELECT COUNT(*) FROM transactions) AS transactions""", one=True)
        recent = query("""SELECT t.transaction_id, t.transaction_type, t.amount, t.note,
            t.created_at, a.account_number, c.full_name
            FROM transactions t JOIN accounts a ON a.account_id=t.account_id
            JOIN customers c ON c.customer_id=a.customer_id
            ORDER BY t.created_at DESC LIMIT 8""")
        return render_template("index.html", stats=stats, recent=recent)
    except Error as exc:
        return render_template("setup_error.html", error=str(exc)), 503


@app.route("/customers", methods=["GET", "POST"])
def customers():
    if request.method == "POST":
        values = tuple(request.form.get(k, "").strip() for k in ("full_name", "email", "phone", "address"))
        if not all(values):
            flash("Please complete every customer field.", "error")
        else:
            try:
                db = connect_db()
                cur = db.cursor()
                cur.execute("INSERT INTO customers(full_name,email,phone,address) VALUES(%s,%s,%s,%s)", values)
                db.commit()
                flash("Customer added successfully.", "success")
            except Error as exc:
                if 'db' in locals(): db.rollback()
                flash("Could not add customer. Check that the email is not already registered.", "error")
            finally:
                if 'cur' in locals(): cur.close()
                if 'db' in locals(): db.close()
            return redirect(url_for("customers"))
    search = request.args.get("q", "").strip()
    rows = query("""SELECT c.*, COUNT(a.account_id) AS account_count
        FROM customers c LEFT JOIN accounts a ON a.customer_id=c.customer_id
        WHERE c.full_name LIKE %s OR c.email LIKE %s OR c.phone LIKE %s
        GROUP BY c.customer_id ORDER BY c.created_at DESC""", (f"%{search}%",)*3)
    return render_template("customers.html", customers=rows, search=search)


@app.route("/api/customers", methods=["GET", "POST"])
def api_customers():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        values = tuple(str(data.get(k, "")).strip() for k in ("full_name", "email", "phone", "address"))
        if not all(values):
            return jsonify(ok=False, message="Complete every customer field."), 400
        try:
            db = connect_db(); cur = db.cursor()
            cur.execute("INSERT INTO customers(full_name,email,phone,address) VALUES(%s,%s,%s,%s)", values)
            db.commit()
            return jsonify(ok=True, message="Customer added.", customer_id=cur.lastrowid), 201
        except Error:
            if 'db' in locals(): db.rollback()
            return jsonify(ok=False, message="Could not add customer. The email may already be registered."), 400
        finally:
            if 'cur' in locals(): cur.close()
            if 'db' in locals(): db.close()
    search = request.args.get("q", "").strip()
    rows = query("""SELECT c.customer_id, c.full_name, c.email, c.phone, c.address,
        c.created_at, COUNT(a.account_id) AS account_count FROM customers c
        LEFT JOIN accounts a ON a.customer_id=c.customer_id
        WHERE c.full_name LIKE %s OR c.email LIKE %s OR c.phone LIKE %s
        GROUP BY c.customer_id ORDER BY c.created_at DESC""", (f"%{search}%",)*3)
    return jsonify([{**row, "created_at": row["created_at"].strftime("%d %b %Y") if row["created_at"] else ""} for row in rows])


@app.route("/api/accounts", methods=["GET", "POST"])
def api_accounts():
    if request.method == "GET":
        rows = query("""SELECT a.*,c.full_name,b.branch_name FROM accounts a
            JOIN customers c USING(customer_id) LEFT JOIN branches b USING(branch_id)
            ORDER BY a.opened_at DESC""")
        return jsonify([{**row, "balance": str(row["balance"]),
            "opened_at": row["opened_at"].strftime("%d %b %Y") if row["opened_at"] else ""} for row in rows])
    data = request.get_json(silent=True) or {}
    try:
        customer_id, branch_id = int(data.get("customer_id", "")), int(data.get("branch_id", ""))
        kind = str(data.get("account_type", ""))
        if kind not in ("Savings", "Current"): raise ValueError("Select Savings or Current.")
        opening = Decimal("0.00") if not str(data.get("opening_balance", "")).strip() else money(data["opening_balance"])
        db = connect_db(); cur = db.cursor()
        cur.execute("INSERT INTO accounts(account_number,customer_id,account_type,balance,branch_id) VALUES(%s,%s,%s,%s,%s)", (account_number(),customer_id,kind,opening,branch_id))
        account_id = cur.lastrowid
        if opening:
            cur.execute("INSERT INTO transactions(account_id,transaction_type,amount,note) VALUES(%s,'Deposit',%s,'Opening deposit')", (account_id,opening))
        db.commit()
        return jsonify(ok=True,message="Account opened.",account_id=account_id),201
    except (ValueError, InvalidOperation, Error) as exc:
        if 'db' in locals(): db.rollback()
        message = str(exc) if isinstance(exc, ValueError) else "Could not open account. Check the customer and branch."
        return jsonify(ok=False,message=message),400
    finally:
        if 'cur' in locals(): cur.close()
        if 'db' in locals(): db.close()


@app.route("/api/accounts/<int:account_id>/branch", methods=["PATCH"])
def api_update_account_branch(account_id):
    data=request.get_json(silent=True) or {}
    try:
        branch_id=int(data.get("branch_id",""));db=connect_db();cur=db.cursor()
        cur.execute("UPDATE accounts SET branch_id=%s WHERE account_id=%s",(branch_id,account_id))
        cur.execute("SELECT account_id FROM accounts WHERE account_id=%s",(account_id,))
        if cur.fetchone() is None: raise ValueError("Account not found.")
        db.commit();return jsonify(ok=True,message="Account branch updated.")
    except (ValueError,Error) as exc:
        if 'db' in locals():db.rollback()
        return jsonify(ok=False,message=str(exc) if isinstance(exc,ValueError) else "Could not update the account branch."),400
    finally:
        if 'cur' in locals():cur.close()
        if 'db' in locals():db.close()


@app.route("/api/branches", methods=["GET", "POST"])
def api_branches():
    if request.method == "GET":
        return jsonify(query("""SELECT b.*,COUNT(DISTINCT a.account_id) AS account_count,
            COUNT(DISTINCT e.employee_id) AS employee_count FROM branches b
            LEFT JOIN accounts a USING(branch_id) LEFT JOIN employees e USING(branch_id)
            GROUP BY b.branch_id ORDER BY b.branch_name"""))
    data=request.get_json(silent=True) or {}
    name,city,ifsc=(str(data.get(k,"")).strip() for k in ("branch_name","city","ifsc_code"))
    if not name or not city or len(ifsc)!=11:
        return jsonify(ok=False,message="Enter a branch name, city, and 11-character IFSC code."),400
    try:
        db=connect_db();cur=db.cursor();cur.execute("INSERT INTO branches(branch_name,city,ifsc_code) VALUES(%s,%s,%s)",(name,city,ifsc));db.commit()
        return jsonify(ok=True,message="Branch added.",branch_id=cur.lastrowid),201
    except Error:
        if 'db' in locals():db.rollback()
        return jsonify(ok=False,message="Could not add branch. The IFSC code may already be in use."),400
    finally:
        if 'cur' in locals():cur.close()
        if 'db' in locals():db.close()


@app.route("/api/employees", methods=["GET", "POST"])
def api_employees():
    if request.method=="GET":
        rows=query("SELECT e.*,b.branch_name FROM employees e JOIN branches b USING(branch_id) ORDER BY e.name")
        return jsonify([{**row,"salary":str(row["salary"])} for row in rows])
    data=request.get_json(silent=True) or {}
    try:
        branch_id=int(data.get("branch_id",""));name=str(data.get("name","")).strip();designation=str(data.get("designation","")).strip();salary=Decimal(str(data.get("salary","")))
        if not name or not designation or not salary.is_finite() or salary<0: raise ValueError("Enter valid employee details and a non-negative salary.")
        db=connect_db();cur=db.cursor();cur.execute("INSERT INTO employees(branch_id,name,designation,salary) VALUES(%s,%s,%s,%s)",(branch_id,name,designation,salary));db.commit()
        return jsonify(ok=True,message="Employee added.",employee_id=cur.lastrowid),201
    except (ValueError,InvalidOperation,Error) as exc:
        if 'db' in locals():db.rollback()
        message=str(exc) if isinstance(exc,ValueError) else "Could not add employee. Check the selected branch and salary."
        return jsonify(ok=False,message=message),400
    finally:
        if 'cur' in locals():cur.close()
        if 'db' in locals():db.close()


@app.route("/api/loans", methods=["GET", "POST"])
def api_loans():
    if request.method=="GET":
        rows=query("SELECT l.*,c.full_name FROM loans l JOIN customers c USING(customer_id) ORDER BY l.loan_id DESC")
        return jsonify([{**row,"amount":str(row["amount"]),"interest_rate":str(row["interest_rate"])} for row in rows])
    data=request.get_json(silent=True) or {}
    try:
        customer_id=int(data.get("customer_id",""));amount=money(data.get("amount",""));loan_type=str(data.get("loan_type","")).strip();rate=Decimal(str(data.get("interest_rate","")))
        if not loan_type or not rate.is_finite() or rate<0 or rate>100: raise ValueError("Enter a loan type and an interest rate from 0 to 100.")
        db=connect_db();cur=db.cursor();cur.execute("INSERT INTO loans(customer_id,amount,loan_type,interest_rate) VALUES(%s,%s,%s,%s)",(customer_id,amount,loan_type,rate));db.commit()
        return jsonify(ok=True,message="Loan recorded.",loan_id=cur.lastrowid),201
    except (ValueError,InvalidOperation,Error) as exc:
        if 'db' in locals():db.rollback()
        message=str(exc) if isinstance(exc,ValueError) else "Could not record loan. Check the customer and values."
        return jsonify(ok=False,message=message),400
    finally:
        if 'cur' in locals():cur.close()
        if 'db' in locals():db.close()


@app.route("/api/transactions", methods=["POST"])
def api_create_transaction():
    data=request.get_json(silent=True) or {}
    try:
        action=str(data.get("action",""));account_id=int(data.get("account_id",""));amount=money(data.get("amount",""));note=str(data.get("note","")).strip()[:255]
        db=connect_db();cur=db.cursor(dictionary=True)
        if action=="transfer":
            target_id=int(data.get("target_account_id",""))
            if target_id==account_id: raise ValueError("Choose two different accounts.")
            ids=sorted((account_id,target_id));cur.execute("SELECT account_id,balance,status FROM accounts WHERE account_id IN (%s,%s) ORDER BY account_id FOR UPDATE",ids)
            locked={r["account_id"]:r for r in cur.fetchall()}
            if len(locked)!=2 or any(r["status"]!="Active" for r in locked.values()): raise ValueError("Both accounts must exist and be active.")
            if locked[account_id]["balance"]<amount: raise ValueError("Insufficient balance.")
            cur.execute("UPDATE accounts SET balance=balance-%s WHERE account_id=%s",(amount,account_id));cur.execute("UPDATE accounts SET balance=balance+%s WHERE account_id=%s",(amount,target_id))
            cur.execute("INSERT INTO transactions(account_id,transaction_type,amount,note,related_account_id) VALUES(%s,'Transfer Out',%s,%s,%s)",(account_id,amount,note or "Account transfer",target_id))
            cur.execute("INSERT INTO transactions(account_id,transaction_type,amount,note,related_account_id) VALUES(%s,'Transfer In',%s,%s,%s)",(target_id,amount,note or "Account transfer",account_id))
            account_ids=[account_id,target_id]
        elif action in ("deposit","withdraw"):
            cur.execute("SELECT balance,status FROM accounts WHERE account_id=%s FOR UPDATE",(account_id,));row=cur.fetchone()
            if not row or row["status"]!="Active": raise ValueError("Choose an active account.")
            if action=="withdraw" and row["balance"]<amount: raise ValueError("Insufficient balance.")
            delta=amount if action=="deposit" else -amount;label="Deposit" if action=="deposit" else "Withdrawal"
            cur.execute("UPDATE accounts SET balance=balance+%s WHERE account_id=%s",(delta,account_id))
            cur.execute("INSERT INTO transactions(account_id,transaction_type,amount,note) VALUES(%s,%s,%s,%s)",(account_id,label,amount,note or label));account_ids=[account_id]
        else: raise ValueError("Choose deposit, withdrawal, or transfer.")
        marks=','.join(['%s']*len(account_ids));cur.execute(f"SELECT account_id,balance FROM accounts WHERE account_id IN ({marks})",tuple(account_ids));balances={str(r["account_id"]):str(r["balance"]) for r in cur.fetchall()}
        db.commit();return jsonify(ok=True,message="Transaction completed successfully.",balances=balances)
    except (ValueError,InvalidOperation,Error) as exc:
        if 'db' in locals():db.rollback()
        message=str(exc) if isinstance(exc,ValueError) else "The transaction could not be completed."
        return jsonify(ok=False,message=message),400
    finally:
        if 'cur' in locals():cur.close()
        if 'db' in locals():db.close()


@app.route("/api/accounts/<int:account_id>/history")
def api_account_history(account_id):
    rows=query("""SELECT transaction_id,transaction_type,amount,note,related_account_id,created_at
        FROM transactions WHERE account_id=%s ORDER BY created_at DESC""",(account_id,))
    return jsonify([{**row,"amount":str(row["amount"]),"created_at":row["created_at"].strftime("%d %b %Y, %I:%M %p") if row["created_at"] else ""} for row in rows])


@app.route("/api/dashboard")
def api_dashboard():
    stats = query("""SELECT (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM accounts WHERE status='Active') AS accounts,
        (SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE status='Active') AS deposits,
        (SELECT COUNT(*) FROM transactions) AS transactions""", one=True)
    return jsonify({key: str(value) if key == "deposits" else value for key, value in stats.items()})


@app.route("/api/transactions/recent")
def api_recent_transactions():
    rows = query("""SELECT t.transaction_id, t.transaction_type, t.amount, t.note,
        t.created_at, a.account_number, c.full_name FROM transactions t
        JOIN accounts a ON a.account_id=t.account_id
        JOIN customers c ON c.customer_id=a.customer_id
        ORDER BY t.created_at DESC LIMIT 25""")
    return jsonify([{**row, "amount": str(row["amount"]),
        "created_at": row["created_at"].strftime("%d %b %Y, %I:%M %p") if row["created_at"] else ""} for row in rows])


@app.route("/accounts", methods=["GET", "POST"])
def accounts():
    if request.method == "POST":
        try:
            customer_id = int(request.form["customer_id"])
            branch_id = int(request.form["branch_id"])
            kind = request.form["account_type"]
            if kind not in ("Savings", "Current"):
                raise ValueError("Select a valid account type.")
            opening = Decimal("0.00") if not request.form.get("opening_balance") else money(request.form["opening_balance"])
            db = connect_db(); cur = db.cursor()
            cur.execute("INSERT INTO accounts(account_number,customer_id,account_type,balance,branch_id) VALUES(%s,%s,%s,%s,%s)", (account_number(), customer_id, kind, opening, branch_id))
            acc_id = cur.lastrowid
            if opening:
                cur.execute("INSERT INTO transactions(account_id,transaction_type,amount,note) VALUES(%s,'Deposit',%s,'Opening deposit')", (acc_id, opening))
            db.commit()
            flash("Account opened successfully.", "success")
        except (ValueError, Error) as exc:
            if 'db' in locals(): db.rollback()
            flash(str(exc) if isinstance(exc, ValueError) else "Could not open account. Check the selected customer.", "error")
        finally:
            if 'cur' in locals(): cur.close()
            if 'db' in locals(): db.close()
        return redirect(url_for("accounts"))
    rows = query("""SELECT a.*, c.full_name, b.branch_name FROM accounts a JOIN customers c USING(customer_id)
        LEFT JOIN branches b USING(branch_id)
        ORDER BY a.opened_at DESC""")
    people = query("SELECT customer_id, full_name, email FROM customers ORDER BY full_name")
    branches = query("SELECT branch_id, branch_name, city FROM branches ORDER BY branch_name")
    return render_template("accounts.html", accounts=rows, customers=people, branches=branches)


@app.route("/account/<int:account_id>/branch", methods=["POST"])
def update_account_branch(account_id):
    try:
        branch_id = int(request.form.get("branch_id", ""))
        db = connect_db(); cur = db.cursor()
        cur.execute("SELECT account_id FROM accounts WHERE account_id=%s", (account_id,))
        if cur.fetchone() is None:
            raise ValueError("Account not found.")
        cur.execute("UPDATE accounts SET branch_id=%s WHERE account_id=%s", (branch_id, account_id))
        db.commit(); flash("Account branch updated.", "success")
    except (ValueError, Error):
        if 'db' in locals(): db.rollback()
        flash("Could not update branch. Please select a valid branch.", "error")
    finally:
        if 'cur' in locals(): cur.close()
        if 'db' in locals(): db.close()
    return redirect(url_for("accounts"))


@app.route("/branches", methods=["GET", "POST"])
def branches():
    if request.method == "POST":
        values = tuple(request.form.get(k, "").strip() for k in ("branch_name", "city", "ifsc_code"))
        if not all(values):
            flash("Please complete every branch field.", "error")
        elif len(values[2]) != 11:
            flash("IFSC code must contain exactly 11 characters.", "error")
        else:
            try:
                db = connect_db(); cur = db.cursor()
                cur.execute("INSERT INTO branches(branch_name,city,ifsc_code) VALUES(%s,%s,%s)", values)
                db.commit(); flash("Branch added successfully.", "success")
            except Error:
                if 'db' in locals(): db.rollback()
                flash("Could not add branch. The IFSC code may already be in use.", "error")
            finally:
                if 'cur' in locals(): cur.close()
                if 'db' in locals(): db.close()
        return redirect(url_for("branches"))
    rows = query("""SELECT b.*, COUNT(DISTINCT a.account_id) AS account_count,
        COUNT(DISTINCT e.employee_id) AS employee_count FROM branches b
        LEFT JOIN accounts a USING(branch_id) LEFT JOIN employees e USING(branch_id)
        GROUP BY b.branch_id ORDER BY b.branch_name""")
    return render_template("branches.html", branches=rows)


@app.route("/employees", methods=["GET", "POST"])
def employees():
    if request.method == "POST":
        try:
            branch_id = int(request.form["branch_id"])
            name = request.form.get("name", "").strip()
            designation = request.form.get("designation", "").strip()
            salary = Decimal(request.form.get("salary", ""))
            if not name or not designation or salary < 0 or not salary.is_finite():
                raise ValueError("Enter valid employee details and a non-negative salary.")
            db = connect_db(); cur = db.cursor()
            cur.execute("INSERT INTO employees(branch_id,name,designation,salary) VALUES(%s,%s,%s,%s)", (branch_id,name,designation,salary))
            db.commit(); flash("Employee added successfully.", "success")
        except (ValueError, InvalidOperation, Error) as exc:
            if 'db' in locals(): db.rollback()
            flash(str(exc) if isinstance(exc, ValueError) else "Could not add employee. Check the selected branch and salary.", "error")
        finally:
            if 'cur' in locals(): cur.close()
            if 'db' in locals(): db.close()
        return redirect(url_for("employees"))
    rows = query("""SELECT e.*, b.branch_name FROM employees e JOIN branches b USING(branch_id)
        ORDER BY e.name""")
    branch_rows = query("SELECT branch_id, branch_name, city FROM branches ORDER BY branch_name")
    return render_template("employees.html", employees=rows, branches=branch_rows)


@app.route("/loans", methods=["GET", "POST"])
def loans():
    if request.method == "POST":
        try:
            customer_id = int(request.form["customer_id"])
            amount = money(request.form.get("amount", ""))
            loan_type = request.form.get("loan_type", "").strip()
            interest_rate = Decimal(request.form.get("interest_rate", ""))
            if not loan_type or not interest_rate.is_finite() or interest_rate < 0 or interest_rate > 100:
                raise ValueError("Enter a loan type and an interest rate from 0 to 100.")
            db = connect_db(); cur = db.cursor()
            cur.execute("INSERT INTO loans(customer_id,amount,loan_type,interest_rate) VALUES(%s,%s,%s,%s)", (customer_id,amount,loan_type,interest_rate))
            db.commit(); flash("Loan recorded successfully.", "success")
        except (ValueError, InvalidOperation, Error) as exc:
            if 'db' in locals(): db.rollback()
            flash(str(exc) if isinstance(exc, ValueError) else "Could not record loan. Check the customer and values.", "error")
        finally:
            if 'cur' in locals(): cur.close()
            if 'db' in locals(): db.close()
        return redirect(url_for("loans"))
    rows = query("""SELECT l.*, c.full_name FROM loans l JOIN customers c USING(customer_id)
        ORDER BY l.loan_id DESC""")
    people = query("SELECT customer_id, full_name FROM customers ORDER BY full_name")
    return render_template("loans.html", loans=rows, customers=people)


@app.route("/transactions", methods=["GET", "POST"])
def transactions():
    if request.method == "POST":
        kind = request.form.get("action")
        is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
        try:
            amount = money(request.form.get("amount", ""))
            account_id = int(request.form.get("account_id", ""))
            note = request.form.get("note", "").strip()[:255]
            db = connect_db(); cur = db.cursor(dictionary=True)
            if kind == "transfer":
                target_id = int(request.form.get("target_account_id", ""))
                if target_id == account_id: raise ValueError("Choose two different accounts.")
                ids = sorted([account_id, target_id])
                cur.execute("SELECT account_id,balance,status FROM accounts WHERE account_id IN (%s,%s) ORDER BY account_id FOR UPDATE", ids)
                locked = {r["account_id"]: r for r in cur.fetchall()}
                if len(locked) != 2 or any(r["status"] != "Active" for r in locked.values()): raise ValueError("Both accounts must exist and be active.")
                if locked[account_id]["balance"] < amount: raise ValueError("Insufficient balance.")
                cur.execute("UPDATE accounts SET balance=balance-%s WHERE account_id=%s", (amount, account_id))
                cur.execute("UPDATE accounts SET balance=balance+%s WHERE account_id=%s", (amount, target_id))
                cur.execute("INSERT INTO transactions(account_id,transaction_type,amount,note,related_account_id) VALUES(%s,'Transfer Out',%s,%s,%s)", (account_id, amount, note or "Account transfer", target_id))
                cur.execute("INSERT INTO transactions(account_id,transaction_type,amount,note,related_account_id) VALUES(%s,'Transfer In',%s,%s,%s)", (target_id, amount, note or "Account transfer", account_id))
            elif kind in ("deposit", "withdraw"):
                cur.execute("SELECT balance,status FROM accounts WHERE account_id=%s FOR UPDATE", (account_id,))
                row = cur.fetchone()
                if not row or row["status"] != "Active": raise ValueError("Choose an active account.")
                if kind == "withdraw" and row["balance"] < amount: raise ValueError("Insufficient balance.")
                delta = amount if kind == "deposit" else -amount
                label = "Deposit" if kind == "deposit" else "Withdrawal"
                cur.execute("UPDATE accounts SET balance=balance+%s WHERE account_id=%s", (delta, account_id))
                cur.execute("INSERT INTO transactions(account_id,transaction_type,amount,note) VALUES(%s,%s,%s,%s)", (account_id, label, amount, note or label))
            else:
                raise ValueError("Select deposit, withdrawal, or transfer.")
            account_ids = [account_id]
            if kind == "transfer":
                account_ids.append(target_id)
            placeholders = ",".join(["%s"] * len(account_ids))
            cur.execute(f"SELECT account_id,balance FROM accounts WHERE account_id IN ({placeholders})", tuple(account_ids))
            updated_balances = {str(row["account_id"]): str(row["balance"]) for row in cur.fetchall()}
            db.commit()
            if is_ajax:
                return jsonify(ok=True, message="Transaction completed successfully.", balances=updated_balances)
            flash("Transaction completed successfully.", "success")
        except (ValueError, Error) as exc:
            if 'db' in locals(): db.rollback()
            if is_ajax:
                return jsonify(ok=False, message=str(exc) if isinstance(exc, ValueError) else "The transaction could not be completed."), 400
            flash(str(exc) if isinstance(exc, ValueError) else "The transaction could not be completed.", "error")
        finally:
            if 'cur' in locals(): cur.close()
            if 'db' in locals(): db.close()
        return redirect(url_for("transactions"))
    rows = query("""SELECT a.account_id,a.account_number,a.balance,c.full_name FROM accounts a
        JOIN customers c USING(customer_id) WHERE a.status='Active' ORDER BY a.account_number""")
    history = query("""SELECT t.*,a.account_number,c.full_name FROM transactions t
        JOIN accounts a USING(account_id) JOIN customers c USING(customer_id)
        ORDER BY t.created_at DESC LIMIT 25""")
    return render_template("transactions.html", accounts=rows, history=history)


@app.route("/account/<int:account_id>/history")
def account_history(account_id):
    account = query("""SELECT a.*,c.full_name FROM accounts a JOIN customers c USING(customer_id)
        WHERE a.account_id=%s""", (account_id,), one=True)
    if not account:
        flash("Account not found.", "error"); return redirect(url_for("accounts"))
    history = query("SELECT * FROM transactions WHERE account_id=%s ORDER BY created_at DESC", (account_id,))
    return render_template("history.html", account=account, history=history)


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
