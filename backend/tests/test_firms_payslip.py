"""Tests for Firms CRUD, firm_id on expense/tax/employees, and Payslip endpoint."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://finance-hub-pro-15.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_TOKEN = os.environ.get("TEST_OWNER_TOKEN", "test_token_1785581543050")
OWNER_USER_ID = os.environ.get("TEST_OWNER_USER_ID", "test_owner_1785581543050")
ACC_TOKEN = os.environ.get("TEST_ACC_TOKEN", "test_acc_session_1785581696596")


def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def owner_h():
    return h(OWNER_TOKEN)


@pytest.fixture(scope="module")
def acc_h():
    return h(ACC_TOKEN)


# ------------- Firms CRUD -------------
class TestFirmsCRUD:
    def test_list_firms_owner(self, owner_h):
        r = requests.get(f"{API}/firms", headers=owner_h)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # ensure no _id field
        for f in data:
            assert "_id" not in f
            assert "firm_id" in f and "name" in f

    def test_list_firms_accountant_allowed(self, acc_h):
        r = requests.get(f"{API}/firms", headers=acc_h)
        assert r.status_code == 200

    def test_create_firm_accountant_forbidden(self, acc_h):
        r = requests.post(f"{API}/firms", json={"name": "TEST_FIRM_acct"}, headers=acc_h)
        assert r.status_code == 403

    def test_create_update_delete_firm_owner(self, owner_h):
        name = f"TEST_FIRM_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/firms", json={"name": name, "gst_number": "GST123", "address": "Addr 1"}, headers=owner_h)
        assert r.status_code == 200, r.text
        firm = r.json()
        assert firm["name"] == name
        assert firm["gst_number"] == "GST123"
        firm_id = firm["firm_id"]

        # verify GET returns it
        r = requests.get(f"{API}/firms", headers=owner_h)
        assert any(f["firm_id"] == firm_id for f in r.json())

        # PUT update
        r = requests.put(f"{API}/firms/{firm_id}", json={"address": "Addr 2"}, headers=owner_h)
        assert r.status_code == 200
        assert r.json()["address"] == "Addr 2"
        assert r.json()["name"] == name  # unchanged

        # Accountant can't update
        r = requests.put(f"{API}/firms/{firm_id}", json={"address": "X"}, headers=h(ACC_TOKEN))
        assert r.status_code == 403

        # DELETE
        r = requests.delete(f"{API}/firms/{firm_id}", headers=owner_h)
        assert r.status_code == 200

        # Confirm gone
        r = requests.get(f"{API}/firms", headers=owner_h)
        assert not any(f["firm_id"] == firm_id for f in r.json())

    def test_delete_firm_detaches_references(self, owner_h):
        # Create firm
        r = requests.post(f"{API}/firms", json={"name": f"TEST_DETACH_{uuid.uuid4().hex[:6]}"}, headers=owner_h)
        firm_id = r.json()["firm_id"]

        # Create employee, expense, tax with firm_id
        r = requests.post(f"{API}/employees", json={"name": f"TEST_EMP_{uuid.uuid4().hex[:4]}", "base_salary": 20000, "firm_id": firm_id}, headers=owner_h)
        assert r.status_code == 200
        emp_id = r.json()["employee_id"]
        assert r.json().get("firm_id") == firm_id

        r = requests.post(f"{API}/expenses", json={"date": "2026-01-05", "vendor": "TEST_V", "category": "Office Expense", "amount": 50, "payment_mode": "Cash", "firm_id": firm_id}, headers=owner_h)
        assert r.status_code == 200
        exp_id = r.json()["expense_id"]
        assert r.json().get("firm_id") == firm_id

        r = requests.post(f"{API}/tax", json={"date": "2026-01-05", "tax_type": "GST", "period": "Q1 2026", "challan_number": "TEST_CH1", "amount": 100, "payment_mode": "UPI/Bank", "firm_id": firm_id}, headers=owner_h)
        assert r.status_code == 200, r.text
        tax_id = r.json().get("tax_id")

        try:
            # Delete firm
            r = requests.delete(f"{API}/firms/{firm_id}", headers=owner_h)
            assert r.status_code == 200

            # References should be detached
            r = requests.get(f"{API}/employees", headers=owner_h)
            emp = next(e for e in r.json() if e["employee_id"] == emp_id)
            assert emp.get("firm_id") in (None, "")

            r = requests.get(f"{API}/expenses", headers=owner_h)
            exp = next(e for e in r.json() if e["expense_id"] == exp_id)
            assert exp.get("firm_id") in (None, "")
        finally:
            requests.delete(f"{API}/employees/{emp_id}", headers=owner_h)
            requests.delete(f"{API}/expenses/{exp_id}", headers=owner_h)
            if tax_id:
                requests.delete(f"{API}/tax/{tax_id}", headers=owner_h)

    def test_update_delete_nonexistent(self, owner_h):
        r = requests.put(f"{API}/firms/firm_nope", json={"name": "X"}, headers=owner_h)
        assert r.status_code == 404
        r = requests.delete(f"{API}/firms/firm_nope", headers=owner_h)
        assert r.status_code == 404


# ------------- firm_id filters -------------
class TestFirmIdFilters:
    @pytest.fixture(scope="class")
    def two_firms(self, owner_h=None):
        oh = h(OWNER_TOKEN)
        f1 = requests.post(f"{API}/firms", json={"name": f"TEST_F1_{uuid.uuid4().hex[:4]}"}, headers=oh).json()["firm_id"]
        f2 = requests.post(f"{API}/firms", json={"name": f"TEST_F2_{uuid.uuid4().hex[:4]}"}, headers=oh).json()["firm_id"]
        yield f1, f2
        requests.delete(f"{API}/firms/{f1}", headers=oh)
        requests.delete(f"{API}/firms/{f2}", headers=oh)

    def test_expenses_firm_filter(self, owner_h, two_firms):
        f1, f2 = two_firms
        e1 = requests.post(f"{API}/expenses", json={"date": "2026-01-10", "vendor": "TEST_F1V", "category": "Office Expense", "amount": 100, "payment_mode": "Cash", "firm_id": f1}, headers=owner_h).json()["expense_id"]
        e2 = requests.post(f"{API}/expenses", json={"date": "2026-01-10", "vendor": "TEST_F2V", "category": "Office Expense", "amount": 200, "payment_mode": "Cash", "firm_id": f2}, headers=owner_h).json()["expense_id"]
        try:
            r = requests.get(f"{API}/expenses", params={"firm_id": f1}, headers=owner_h)
            assert r.status_code == 200
            ids = [x["expense_id"] for x in r.json()]
            assert e1 in ids and e2 not in ids
        finally:
            requests.delete(f"{API}/expenses/{e1}", headers=owner_h)
            requests.delete(f"{API}/expenses/{e2}", headers=owner_h)

    def test_tax_firm_filter(self, owner_h, two_firms):
        f1, f2 = two_firms
        t1 = requests.post(f"{API}/tax", json={"date": "2026-02-05", "tax_type": "GST", "period": "Q1 2026", "challan_number": "TEST_CHF1", "amount": 500, "payment_mode": "UPI/Bank", "firm_id": f1}, headers=owner_h).json()
        t2 = requests.post(f"{API}/tax", json={"date": "2026-02-05", "tax_type": "GST", "period": "Q1 2026", "challan_number": "TEST_CHF2", "amount": 700, "payment_mode": "UPI/Bank", "firm_id": f2}, headers=owner_h).json()
        id1 = t1.get("tax_id")
        id2 = t2.get("tax_id")
        try:
            r = requests.get(f"{API}/tax", params={"firm_id": f1}, headers=owner_h)
            assert r.status_code == 200
            # each returned item should be for f1
            for item in r.json():
                if item.get("firm_id"):
                    assert item["firm_id"] == f1
        finally:
            if id1:
                requests.delete(f"{API}/tax/{id1}", headers=owner_h)
            if id2:
                requests.delete(f"{API}/tax/{id2}", headers=owner_h)

    def test_dashboard_firm_filter(self, owner_h, two_firms):
        f1, _ = two_firms
        e1 = requests.post(f"{API}/expenses", json={"date": "2026-03-05", "vendor": "TEST_DASH", "category": "Office Expense", "amount": 999, "payment_mode": "Cash", "firm_id": f1}, headers=owner_h).json()["expense_id"]
        try:
            r = requests.get(f"{API}/dashboard", params={"month": "2026-03", "firm_id": f1}, headers=owner_h)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["total_spend"] >= 999
            assert "category_breakdown" in data
        finally:
            requests.delete(f"{API}/expenses/{e1}", headers=owner_h)

    def test_ledger_firm_filter(self, owner_h, two_firms):
        f1, f2 = two_firms
        emp1 = requests.post(f"{API}/employees", json={"name": f"TEST_EL1_{uuid.uuid4().hex[:4]}", "base_salary": 10000, "firm_id": f1}, headers=owner_h).json()["employee_id"]
        emp2 = requests.post(f"{API}/employees", json={"name": f"TEST_EL2_{uuid.uuid4().hex[:4]}", "base_salary": 12000, "firm_id": f2}, headers=owner_h).json()["employee_id"]
        try:
            r = requests.get(f"{API}/ledger", params={"month": "2026-01", "firm_id": f1}, headers=owner_h)
            assert r.status_code == 200
            emp_ids = [e["employee_id"] for e in r.json()["employees"]]
            assert emp1 in emp_ids and emp2 not in emp_ids
        finally:
            requests.delete(f"{API}/employees/{emp1}", headers=owner_h)
            requests.delete(f"{API}/employees/{emp2}", headers=owner_h)


# ------------- Employee firm_id update -------------
class TestEmployeeFirmAssign:
    def test_employee_firm_update(self, owner_h):
        firm = requests.post(f"{API}/firms", json={"name": f"TEST_EFA_{uuid.uuid4().hex[:4]}"}, headers=owner_h).json()
        emp = requests.post(f"{API}/employees", json={"name": f"TEST_EMPFA_{uuid.uuid4().hex[:4]}", "base_salary": 15000}, headers=owner_h).json()
        try:
            assert emp.get("firm_id") in (None, "")
            r = requests.put(f"{API}/employees/{emp['employee_id']}", json={"firm_id": firm["firm_id"]}, headers=owner_h)
            assert r.status_code == 200, r.text
            # verify persisted via GET
            r = requests.get(f"{API}/employees", headers=owner_h)
            e = next(x for x in r.json() if x["employee_id"] == emp["employee_id"])
            assert e["firm_id"] == firm["firm_id"]
        finally:
            requests.delete(f"{API}/employees/{emp['employee_id']}", headers=owner_h)
            requests.delete(f"{API}/firms/{firm['firm_id']}", headers=owner_h)


# ------------- Payslip -------------
class TestPayslip:
    def test_payslip_with_firm_and_advances(self, owner_h):
        firm = requests.post(f"{API}/firms", json={"name": f"TEST_PS_{uuid.uuid4().hex[:4]}", "gst_number": "GSTPS"}, headers=owner_h).json()
        emp = requests.post(f"{API}/employees", json={"name": f"TEST_PSEMP_{uuid.uuid4().hex[:4]}", "base_salary": 40000, "firm_id": firm["firm_id"]}, headers=owner_h).json()
        # advance 5000 outstanding + 2000 repaid
        adv1 = requests.post(f"{API}/expenses", json={"date": "2026-04-05", "vendor": emp["name"], "category": "Salary Advance", "amount": 5000, "payment_mode": "Cash", "employee_id": emp["employee_id"]}, headers=owner_h).json()["expense_id"]
        adv2 = requests.post(f"{API}/expenses", json={"date": "2026-04-15", "vendor": emp["name"], "category": "Salary Advance", "amount": 2000, "payment_mode": "Cash", "employee_id": emp["employee_id"]}, headers=owner_h).json()["expense_id"]
        requests.patch(f"{API}/expenses/{adv2}/repay", json={"repaid": True}, headers=owner_h)
        try:
            r = requests.get(f"{API}/payslip/{emp['employee_id']}", params={"month": "2026-04"}, headers=owner_h)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["month"] == "2026-04"
            assert d["employee"]["employee_id"] == emp["employee_id"]
            assert d["firm"] and d["firm"]["firm_id"] == firm["firm_id"]
            assert d["base_salary"] == 40000
            assert d["total_outstanding_advance"] == 5000
            assert d["total_repaid_advance"] == 2000
            assert d["net_payable"] == 40000 - 5000
            assert len(d["advances"]) == 2
            # ensure _id excluded
            for a in d["advances"]:
                assert "_id" not in a
        finally:
            requests.delete(f"{API}/expenses/{adv1}", headers=owner_h)
            requests.delete(f"{API}/expenses/{adv2}", headers=owner_h)
            requests.delete(f"{API}/employees/{emp['employee_id']}", headers=owner_h)
            requests.delete(f"{API}/firms/{firm['firm_id']}", headers=owner_h)

    def test_payslip_no_advances_no_firm(self, owner_h):
        emp = requests.post(f"{API}/employees", json={"name": f"TEST_PSNA_{uuid.uuid4().hex[:4]}", "base_salary": 25000}, headers=owner_h).json()
        try:
            r = requests.get(f"{API}/payslip/{emp['employee_id']}", params={"month": "2026-05"}, headers=owner_h)
            assert r.status_code == 200
            d = r.json()
            assert d["firm"] is None
            assert d["total_outstanding_advance"] == 0
            assert d["total_repaid_advance"] == 0
            assert d["net_payable"] == 25000
            assert d["advances"] == []
        finally:
            requests.delete(f"{API}/employees/{emp['employee_id']}", headers=owner_h)

    def test_payslip_not_found(self, owner_h):
        r = requests.get(f"{API}/payslip/emp_nope", params={"month": "2026-01"}, headers=owner_h)
        assert r.status_code == 404

    def test_payslip_accountant_allowed(self, acc_h, owner_h):
        # create as owner, read as accountant
        emp = requests.post(f"{API}/employees", json={"name": f"TEST_PSACC_{uuid.uuid4().hex[:4]}", "base_salary": 18000}, headers=owner_h).json()
        try:
            r = requests.get(f"{API}/payslip/{emp['employee_id']}", headers=acc_h)
            assert r.status_code == 200
        finally:
            requests.delete(f"{API}/employees/{emp['employee_id']}", headers=owner_h)
