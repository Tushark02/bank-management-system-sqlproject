-- HDLC Bank Management System — complete MySQL schema.
-- Run this on a fresh MySQL installation to create all six project tables.
-- CREATE TABLE IF NOT EXISTS keeps existing tables and their data intact.
CREATE DATABASE IF NOT EXISTS bank_management
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE bank_management;

CREATE TABLE IF NOT EXISTS branches (
  branch_id INT AUTO_INCREMENT PRIMARY KEY,
  branch_name VARCHAR(120) NOT NULL,
  city VARCHAR(100) NOT NULL,
  ifsc_code VARCHAR(11) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  address VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  account_id INT AUTO_INCREMENT PRIMARY KEY,
  account_number CHAR(12) NOT NULL UNIQUE,
  customer_id INT NOT NULL,
  branch_id INT NULL,
  account_type ENUM('Savings', 'Current') NOT NULL,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status ENUM('Active', 'Closed') NOT NULL DEFAULT 'Active',
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_account_balance CHECK (balance >= 0),
  CONSTRAINT fk_accounts_customer FOREIGN KEY (customer_id)
    REFERENCES customers(customer_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_accounts_branch FOREIGN KEY (branch_id)
    REFERENCES branches(branch_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_accounts_customer (customer_id),
  INDEX idx_accounts_branch (branch_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  transaction_type ENUM('Deposit', 'Withdrawal', 'Transfer In', 'Transfer Out') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  note VARCHAR(255),
  related_account_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_transaction_amount CHECK (amount > 0),
  CONSTRAINT fk_transactions_account FOREIGN KEY (account_id)
    REFERENCES accounts(account_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_transactions_related_account FOREIGN KEY (related_account_id)
    REFERENCES accounts(account_id) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_transactions_account_date (account_id, created_at)
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  designation VARCHAR(100) NOT NULL,
  salary DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_employees_branch FOREIGN KEY (branch_id)
    REFERENCES branches(branch_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_employees_branch (branch_id)
);

CREATE TABLE IF NOT EXISTS loans (
  loan_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  loan_type VARCHAR(60) NOT NULL,
  interest_rate DECIMAL(5,2) NOT NULL,
  CONSTRAINT fk_loans_customer FOREIGN KEY (customer_id)
    REFERENCES customers(customer_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_loans_customer (customer_id)
);
