from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import csv
import logging
import uuid
import secrets
import hashlib
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")
passwords = CryptContext(schemes=["bcrypt"], deprecated="auto")

# -------- Helpers --------
def now_utc():
    return datetime.now(timezone.utc)

def iso(dt: datetime) -> str:
    return dt.isoformat()

DEFAULT_CATEGORIES = [
    {"name": "Petrol/Fuel", "color": "#E11D48", "is_default": True},
    {"name": "Office Expense", "color": "#2563EB", "is_default": True},
    {"name": "Vendor Payment", "color": "#7C3AED", "is_default": True},
    {"name": "Tax Payment", "color": "#D97706", "is_default": True},
    {"name": "Salary Advance", "color": "#059669", "is_default": True},
    {"name": "Employer Salary", "color": "#0F766E", "is_default": True},
]

async def ensure_defaults():
    for c in DEFAULT_CATEGORIES:
        if not await db.categories.find_one({"name": c["name"]}):
            await db.categories.insert_one({
                "category_id": f"cat_{uuid.uuid4().hex[:10]}",
                "name": c["name"],
                "color": c["color"],
                "is_default": True,
                "created_at": iso(now_utc()),
            })

@app.on_event("startup")
async def startup():
    await ensure_defaults()

# -------- Auth --------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: str = "accountant"  # owner | accountant

async def get_current_user(request: Request) -> User:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    session = await db.user_sessions.find_one({"$or": [{"session_token_hash": token_hash}, {"session_token": token}]}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user_doc)

async def require_owner(user: User = Depends(get_current_user)) -> User:
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return user

def _owner_emails() -> set:
    raw = os.environ.get("OWNER_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}

async def _resolve_role_for(email: str, current_role: Optional[str] = None) -> str:
    """Decide the correct role for a given email based on OWNER_EMAILS env + invitations."""
    email_l = email.lower()
    if email_l in _owner_emails():
        return "owner"
    inv = await db.invitations.find_one({"email": email_l}, {"_id": 0})
    if inv:
        return inv.get("role") or "accountant"
    if current_role:
        return current_role
    user_count = await db.users.count_documents({})
    return "owner" if user_count == 0 else "accountant"

class LoginPayload(BaseModel):
    email: str
    password: str

async def _create_session(user: dict, response: Response):
    session_token = secrets.token_urlsafe(48)
    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
    await db.user_sessions.insert_one({
        "user_id": user["user_id"],
        "session_token_hash": hashlib.sha256(session_token.encode()).hexdigest(),
        "expires_at": iso(expires_at),
        "created_at": iso(now_utc()),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 3600,
        httponly=True,
        secure=os.environ.get("COOKIE_SECURE", "true").lower() == "true",
        samesite="none" if os.environ.get("COOKIE_SECURE", "true").lower() == "true" else "lax",
        path="/",
    )
    return User(**user).model_dump()

@api_router.post("/auth/login")
async def password_login(payload: LoginPayload, response: Response):
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    initial_owner_password = os.environ.get("OWNER_INITIAL_PASSWORD", "")
    if not user and email in _owner_emails() and initial_owner_password and secrets.compare_digest(payload.password, initial_owner_password):
        user = {"user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email, "name": "Owner", "role": "owner", "created_at": iso(now_utc()), "password_hash": passwords.hash(payload.password)}
        await db.users.insert_one(user)
    if not user or not user.get("password_hash") or not passwords.verify(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return await _create_session(user, response)

class PasswordChange(BaseModel):
    current_password: Optional[str] = None
    new_password: str

@api_router.post("/auth/change-password")
async def change_password(payload: PasswordChange, user: User = Depends(get_current_user)):
    if len(payload.new_password) < 10:
        raise HTTPException(status_code=400, detail="Password must have at least 10 characters")
    current = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if current.get("password_hash") and (not payload.current_password or not passwords.verify(payload.current_password, current["password_hash"])):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"password_hash": passwords.hash(payload.new_password), "password_changed_at": iso(now_utc())}})
    return {"ok": True}

@api_router.get("/auth/me")
async def me(user: User = Depends(get_current_user)):
    # Auto-promote: if email is in OWNER_EMAILS but role isn't owner, fix it now
    correct_role = await _resolve_role_for(user.email, user.role)
    if correct_role != user.role:
        await db.users.update_one({"user_id": user.user_id}, {"$set": {"role": correct_role}})
        user.role = correct_role
    return user.model_dump()

@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token_hash": hashlib.sha256(token.encode()).hexdigest()})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}

# -------- Categories --------
class CategoryCreate(BaseModel):
    name: str
    color: Optional[str] = "#71717a"

@api_router.get("/categories")
async def list_categories(user: User = Depends(get_current_user)):
    docs = await db.categories.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs

@api_router.post("/categories")
async def create_category(payload: CategoryCreate, user: User = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    existing = await db.categories.find_one({"name": name}, {"_id": 0})
    if existing:
        return existing
    doc = {
        "category_id": f"cat_{uuid.uuid4().hex[:10]}",
        "name": name,
        "color": payload.color or "#71717a",
        "is_default": False,
        "created_at": iso(now_utc()),
    }
    await db.categories.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.delete("/categories/{category_id}")
async def delete_category(category_id: str, user: User = Depends(require_owner)):
    cat = await db.categories.find_one({"category_id": category_id}, {"_id": 0})
    if not cat:
        raise HTTPException(status_code=404, detail="Not found")
    if cat.get("is_default"):
        raise HTTPException(status_code=400, detail="Cannot delete default category")
    await db.categories.delete_one({"category_id": category_id})
    return {"ok": True}

# -------- Firms --------
class FirmCreate(BaseModel):
    name: str
    gst_number: Optional[str] = ""
    address: Optional[str] = ""

class FirmUpdate(BaseModel):
    name: Optional[str] = None
    gst_number: Optional[str] = None
    address: Optional[str] = None

@api_router.get("/firms")
async def list_firms(user: User = Depends(get_current_user)):
    docs = await db.firms.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs

@api_router.post("/firms")
async def create_firm(payload: FirmCreate, user: User = Depends(require_owner)):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name required")
    doc = {
        "firm_id": f"firm_{uuid.uuid4().hex[:10]}",
        "name": payload.name.strip(),
        "gst_number": (payload.gst_number or "").strip(),
        "address": (payload.address or "").strip(),
        "created_at": iso(now_utc()),
    }
    await db.firms.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/firms/{firm_id}")
async def update_firm(firm_id: str, payload: FirmUpdate, user: User = Depends(require_owner)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields")
    r = await db.firms.update_one({"firm_id": firm_id}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.firms.find_one({"firm_id": firm_id}, {"_id": 0})

@api_router.delete("/firms/{firm_id}")
async def delete_firm(firm_id: str, user: User = Depends(require_owner)):
    # Detach references
    await db.employees.update_many({"firm_id": firm_id}, {"$set": {"firm_id": None}})
    await db.expenses.update_many({"firm_id": firm_id}, {"$set": {"firm_id": None}})
    await db.tax_entries.update_many({"firm_id": firm_id}, {"$set": {"firm_id": None}})
    r = await db.firms.delete_one({"firm_id": firm_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

# -------- Employees --------
class EmployeeCreate(BaseModel):
    name: str
    base_salary: float
    role_title: Optional[str] = ""
    firm_id: Optional[str] = None

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    base_salary: Optional[float] = None
    role_title: Optional[str] = None
    firm_id: Optional[str] = None

@api_router.get("/employees")
async def list_employees(user: User = Depends(get_current_user)):
    docs = await db.employees.find({"active": {"$ne": False}}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs

@api_router.post("/employees")
async def create_employee(payload: EmployeeCreate, user: User = Depends(require_owner)):
    doc = {
        "employee_id": f"emp_{uuid.uuid4().hex[:10]}",
        "name": payload.name.strip(),
        "base_salary": float(payload.base_salary),
        "role_title": payload.role_title or "",
        "firm_id": payload.firm_id,
        "active": True,
        "created_at": iso(now_utc()),
    }
    await db.employees.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/employees/{employee_id}")
async def update_employee(employee_id: str, payload: EmployeeUpdate, user: User = Depends(require_owner)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    r = await db.employees.update_one({"employee_id": employee_id}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    return doc

@api_router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, user: User = Depends(require_owner)):
    r = await db.employees.update_one({"employee_id": employee_id}, {"$set": {"active": False}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

# -------- Expenses --------
class ExpenseCreate(BaseModel):
    date: str  # YYYY-MM-DD
    vendor: str
    category: str
    amount: float
    payment_mode: str  # Cash | UPI/Bank
    notes: Optional[str] = ""
    employee_id: Optional[str] = None  # for Salary Advance
    firm_id: Optional[str] = None
    receipt_url: Optional[str] = ""
    salary_paid_by: Optional[str] = None  # Owner | Accountant; only for Employer Salary

class ExpenseUpdate(BaseModel):
    date: Optional[str] = None
    vendor: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    payment_mode: Optional[str] = None
    notes: Optional[str] = None
    employee_id: Optional[str] = None
    firm_id: Optional[str] = None
    receipt_url: Optional[str] = None
    salary_paid_by: Optional[str] = None

@api_router.get("/expenses")
async def list_expenses(
    user: User = Depends(get_current_user),
    category: Optional[str] = None,
    payment_mode: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    firm_id: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 500,
):
    q = {}
    if category:
        q["category"] = category
    if payment_mode:
        q["payment_mode"] = payment_mode
    if firm_id:
        q["firm_id"] = firm_id
    if search and search.strip():
        q["vendor"] = {"$regex": search.strip(), "$options": "i"}
    if start or end:
        dq = {}
        if start:
            dq["$gte"] = start
        if end:
            dq["$lte"] = end
        q["date"] = dq
    docs = await db.expenses.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(limit)
    return docs

@api_router.post("/expenses")
async def create_expense(payload: ExpenseCreate, user: User = Depends(get_current_user)):
    if payload.payment_mode not in ("Cash", "UPI/Bank"):
        raise HTTPException(status_code=400, detail="Invalid payment_mode")
    if payload.category == "Employer Salary" and payload.salary_paid_by not in ("Owner", "Accountant"):
        raise HTTPException(status_code=400, detail="Choose whether the Owner or Accountant paid the salary")
    doc = {
        "expense_id": f"exp_{uuid.uuid4().hex[:10]}",
        "date": payload.date,
        "vendor": payload.vendor.strip(),
        "category": payload.category.strip(),
        "amount": float(payload.amount),
        "payment_mode": payload.payment_mode,
        "notes": payload.notes or "",
        "employee_id": payload.employee_id,
        "firm_id": payload.firm_id,
        "receipt_url": payload.receipt_url or "",
        "salary_paid_by": payload.salary_paid_by if payload.category == "Employer Salary" else None,
        "created_by": user.user_id,
        "created_at": iso(now_utc()),
    }
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, payload: ExpenseUpdate, user: User = Depends(get_current_user)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    r = await db.expenses.update_one({"expense_id": expense_id}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    return doc

@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user: User = Depends(require_owner)):
    r = await db.expenses.delete_one({"expense_id": expense_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

class RepayPayload(BaseModel):
    repaid: bool = True

class SalaryPayment(BaseModel):
    paid: bool = True
    payment_mode: str = "UPI/Bank"

@api_router.patch("/expenses/{expense_id}/repay")
async def repay_advance(expense_id: str, payload: RepayPayload, user: User = Depends(get_current_user)):
    exp = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    if not exp:
        raise HTTPException(status_code=404, detail="Not found")
    if exp.get("category") != "Salary Advance":
        raise HTTPException(status_code=400, detail="Only salary advances can be marked repaid")
    update = {"repaid": bool(payload.repaid)}
    if payload.repaid:
        update["repaid_at"] = iso(now_utc())
    else:
        update["repaid_at"] = None
    await db.expenses.update_one({"expense_id": expense_id}, {"$set": update})
    doc = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    return doc

@api_router.patch("/employees/{employee_id}/salary-payment")
async def mark_salary_paid(employee_id: str, payload: SalaryPayment, month: str = Query(...), user: User = Depends(require_owner)):
    if not await db.employees.find_one({"employee_id": employee_id}): raise HTTPException(status_code=404, detail="Employee not found")
    await db.salary_payments.update_one({"employee_id": employee_id, "month": month}, {"$set": {"employee_id": employee_id, "month": month, "paid": payload.paid, "payment_mode": payload.payment_mode, "paid_at": iso(now_utc()) if payload.paid else None, "paid_by": user.user_id}}, upsert=True)
    return {"ok": True}

@api_router.get("/expenses/export")
async def export_expenses(user: User = Depends(get_current_user)):
    docs = await db.expenses.find({}, {"_id": 0}).sort("date", -1).to_list(10000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Vendor", "Category", "Amount (INR)", "Payment Mode", "Notes"])
    for d in docs:
        w.writerow([d.get("date"), d.get("vendor"), d.get("category"), d.get("amount"), d.get("payment_mode"), d.get("notes", "")])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=expenses.csv"})

@api_router.post("/expenses/import")
async def import_expenses(file: UploadFile = File(...), user: User = Depends(require_owner)):
    """Owner-only CSV import. Required columns: Date, Vendor, Category, Amount (INR), Payment Mode."""
    try:
        rows = list(csv.DictReader((await file.read()).decode("utf-8-sig").splitlines()))
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Please upload a UTF-8 CSV file")
    created = 0
    for row in rows:
        date, vendor = row.get("Date", "").strip(), row.get("Vendor", "").strip()
        category, mode = row.get("Category", "").strip(), row.get("Payment Mode", "").strip()
        if not date or not vendor or not category or mode not in ("Cash", "UPI/Bank"): continue
        try: amount = float(row.get("Amount (INR)", ""))
        except ValueError: continue
        await db.expenses.insert_one({"expense_id": f"exp_{uuid.uuid4().hex[:10]}", "date": date, "vendor": vendor, "category": category, "amount": amount, "payment_mode": mode, "notes": row.get("Notes", ""), "created_by": user.user_id, "created_at": iso(now_utc()), "imported": True})
        created += 1
    return {"ok": True, "imported": created, "skipped": len(rows) - created}

class RecurringExpense(BaseModel):
    vendor: str; category: str; amount: float; payment_mode: str = "UPI/Bank"; day_of_month: int = Field(1, ge=1, le=28); notes: str = ""; firm_id: Optional[str] = None

@api_router.get("/recurring-expenses")
async def list_recurring(user: User = Depends(get_current_user)):
    return await db.recurring_expenses.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.post("/recurring-expenses")
async def create_recurring(payload: RecurringExpense, user: User = Depends(require_owner)):
    doc = payload.model_dump() | {"recurring_id": f"rec_{uuid.uuid4().hex[:10]}", "active": True, "created_at": iso(now_utc())}
    await db.recurring_expenses.insert_one(doc); return doc

@api_router.delete("/recurring-expenses/{recurring_id}")
async def delete_recurring(recurring_id: str, user: User = Depends(require_owner)):
    await db.recurring_expenses.delete_one({"recurring_id": recurring_id}); return {"ok": True}

class Budget(BaseModel):
    category: str; amount: float; month: str; firm_id: Optional[str] = None

@api_router.get("/budgets")
async def list_budgets(month: Optional[str] = None, user: User = Depends(get_current_user)):
    q = {"month": month} if month else {}; return await db.budgets.find(q, {"_id": 0}).to_list(500)

@api_router.put("/budgets")
async def save_budget(payload: Budget, user: User = Depends(require_owner)):
    doc = payload.model_dump() | {"updated_at": iso(now_utc())}; await db.budgets.update_one({"month": payload.month, "category": payload.category, "firm_id": payload.firm_id}, {"$set": doc}, upsert=True); return doc

# -------- Tax Compliance --------
class TaxCreate(BaseModel):
    date: str
    tax_type: str  # GST | ITR Advance Tax
    period: Optional[str] = ""  # e.g., Q1 2025, FY 2024-25
    challan_number: str
    amount: float
    payment_mode: str  # UPI/Bank | Cash
    notes: Optional[str] = ""
    firm_id: Optional[str] = None

@api_router.get("/tax")
async def list_tax(user: User = Depends(get_current_user), firm_id: Optional[str] = None):
    q = {}
    if firm_id:
        q["firm_id"] = firm_id
    docs = await db.tax_entries.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    return docs

@api_router.post("/tax")
async def create_tax(payload: TaxCreate, user: User = Depends(get_current_user)):
    doc = {
        "tax_id": f"tax_{uuid.uuid4().hex[:10]}",
        "date": payload.date,
        "tax_type": payload.tax_type,
        "period": payload.period or "",
        "challan_number": payload.challan_number.strip(),
        "amount": float(payload.amount),
        "payment_mode": payload.payment_mode,
        "notes": payload.notes or "",
        "firm_id": payload.firm_id,
        "created_by": user.user_id,
        "created_at": iso(now_utc()),
    }
    await db.tax_entries.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.delete("/tax/{tax_id}")
async def delete_tax(tax_id: str, user: User = Depends(require_owner)):
    r = await db.tax_entries.delete_one({"tax_id": tax_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@api_router.get("/tax/export")
async def export_tax(user: User = Depends(get_current_user)):
    docs = await db.tax_entries.find({}, {"_id": 0}).sort("date", -1).to_list(10000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Tax Type", "Period", "Challan Number", "Amount (INR)", "Payment Mode", "Notes"])
    for d in docs:
        w.writerow([d.get("date"), d.get("tax_type"), d.get("period"), d.get("challan_number"), d.get("amount"), d.get("payment_mode"), d.get("notes", "")])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=tax_register.csv"})

# -------- Salary Ledger --------
class AttendanceUpdate(BaseModel):
    employee_id: str
    date: str  # YYYY-MM-DD
    status: str  # Present | Half Day | Absent
    notes: Optional[str] = ""

@api_router.get("/attendance")
async def list_attendance(date: str = Query(...), firm_id: Optional[str] = None, user: User = Depends(get_current_user)):
    emp_q = {"active": {"$ne": False}}
    if firm_id: emp_q["firm_id"] = firm_id
    employees = await db.employees.find(emp_q, {"_id": 0}).sort("name", 1).to_list(500)
    records = await db.attendance.find({"date": date}, {"_id": 0}).to_list(500)
    record_map = {r["employee_id"]: r for r in records}
    return {"date": date, "employees": [{**e, "attendance": record_map.get(e["employee_id"])} for e in employees]}

@api_router.put("/attendance")
async def save_attendance(payload: AttendanceUpdate, user: User = Depends(get_current_user)):
    if payload.status not in ("Present", "Half Day", "Absent"):
        raise HTTPException(status_code=400, detail="Status must be Present, Half Day, or Absent")
    if not await db.employees.find_one({"employee_id": payload.employee_id, "active": {"$ne": False}}):
        raise HTTPException(status_code=404, detail="Active employee not found")
    doc = {"employee_id": payload.employee_id, "date": payload.date, "status": payload.status, "notes": payload.notes or "", "updated_by": user.user_id, "updated_at": iso(now_utc())}
    await db.attendance.update_one({"employee_id": payload.employee_id, "date": payload.date}, {"$set": doc}, upsert=True)
    return doc

@api_router.get("/attendance/summary")
async def attendance_summary(month: str = Query(...), firm_id: Optional[str] = None, user: User = Depends(get_current_user)):
    year, m = map(int, month.split("-")); next_month = f"{year+1}-01-01" if m == 12 else f"{year}-{m+1:02d}-01"
    emp_q = {"active": {"$ne": False}}
    if firm_id: emp_q["firm_id"] = firm_id
    employees = await db.employees.find(emp_q, {"_id": 0}).to_list(500)
    days_in_month = (datetime(year + (m == 12), 1 if m == 12 else m + 1, 1) - datetime(year, m, 1)).days
    rows = []
    for e in employees:
        records = await db.attendance.find({"employee_id": e["employee_id"], "date": {"$gte": f"{month}-01", "$lt": next_month}}, {"_id": 0}).to_list(100)
        present = sum(r["status"] == "Present" for r in records); half = sum(r["status"] == "Half Day" for r in records); absent = sum(r["status"] == "Absent" for r in records)
        payable_days = present + half * .5
        salary = float(e["base_salary"]) if not records else round(float(e["base_salary"]) * payable_days / days_in_month, 2)
        rows.append({"employee_id": e["employee_id"], "name": e["name"], "base_salary": e["base_salary"], "present_days": present, "half_days": half, "absent_days": absent, "payable_days": payable_days, "calculated_salary": salary, "attendance_recorded": bool(records), "records": sorted(records, key=lambda r: r["date"])})
    return {"month": month, "days_in_month": days_in_month, "employees": rows}

@api_router.get("/ledger")
async def ledger(user: User = Depends(get_current_user), month: Optional[str] = Query(None), firm_id: Optional[str] = None):
    """month format: YYYY-MM. Returns per-employee advances and net payable for the month."""
    if not month:
        month = now_utc().strftime("%Y-%m")
    emp_q = {"active": {"$ne": False}}
    if firm_id:
        emp_q["firm_id"] = firm_id
    employees = await db.employees.find(emp_q, {"_id": 0}).to_list(500)
    start = f"{month}-01"
    # end: last day of month
    year, m = map(int, month.split("-"))
    if m == 12:
        next_month = f"{year+1}-01-01"
    else:
        next_month = f"{year}-{m+1:02d}-01"
    result = []
    for e in employees:
        attendance_records = await db.attendance.find({"employee_id": e["employee_id"], "date": {"$gte": start, "$lt": next_month}}, {"_id": 0}).to_list(100)
        days_in_month = (datetime(year + (m == 12), 1 if m == 12 else m + 1, 1) - datetime(year, m, 1)).days
        payable_days = sum(1 if r["status"] == "Present" else .5 if r["status"] == "Half Day" else 0 for r in attendance_records)
        attendance_salary = float(e["base_salary"]) if not attendance_records else round(float(e["base_salary"]) * payable_days / days_in_month, 2)
        pipeline = [
            {"$match": {"employee_id": e["employee_id"], "category": "Salary Advance", "date": {"$gte": start, "$lt": next_month}, "repaid": {"$ne": True}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
        agg = await db.expenses.aggregate(pipeline).to_list(1)
        advances = float(agg[0]["total"]) if agg else 0.0
        # Return ALL advances (including repaid) so UI can show status
        advances_list = await db.expenses.find(
            {"employee_id": e["employee_id"], "category": "Salary Advance", "date": {"$gte": start, "$lt": next_month}},
            {"_id": 0}
        ).sort("date", -1).to_list(200)
        result.append({
            "employee_id": e["employee_id"],
            "name": e["name"],
            "role_title": e.get("role_title", ""),
            "base_salary": e["base_salary"],
            "advances": advances,
            "attendance_salary": attendance_salary,
            "payable_days": payable_days if attendance_records else days_in_month,
            "attendance_recorded": bool(attendance_records),
            "net_payable": attendance_salary - advances,
            "advance_entries": advances_list,
        })
    return {"month": month, "employees": result}

# -------- Dashboard --------
@api_router.get("/dashboard")
async def dashboard(user: User = Depends(get_current_user), month: Optional[str] = Query(None), year: Optional[str] = Query(None)):
    if year:
        start, next_month, period_label = f"{year}-01-01", f"{int(year)+1}-01-01", year
    else:
        if not month: month = now_utc().strftime("%Y-%m")
        start = f"{month}-01"; y, m = map(int, month.split("-"))
        next_month = f"{y+1}-01-01" if m == 12 else f"{y}-{m+1:02d}-01"; period_label = month

    date_q = {"date": {"$gte": start, "$lt": next_month}}
    expenses = await db.expenses.find(date_q, {"_id": 0}).to_list(10000)

    total_spend = sum(e["amount"] for e in expenses)
    total_petrol = sum(e["amount"] for e in expenses if e["category"] == "Petrol/Fuel")
    # Outstanding advances (exclude repaid) — matches Staff Ledger net-payable
    total_advances = sum(e["amount"] for e in expenses if e["category"] == "Salary Advance" and not e.get("repaid"))
    cash = sum(e["amount"] for e in expenses if e["payment_mode"] == "Cash")
    upi = sum(e["amount"] for e in expenses if e["payment_mode"] == "UPI/Bank")

    breakdown = {}
    for e in expenses:
        breakdown[e["category"]] = breakdown.get(e["category"], 0.0) + e["amount"]

    # Include zero for categories that don't have expenses so custom cats still show
    cats = await db.categories.find({}, {"_id": 0}).to_list(500)
    cat_map = {c["name"]: c.get("color", "#71717a") for c in cats}
    for c in cats:
        breakdown.setdefault(c["name"], 0.0)

    breakdown_list = [{"category": k, "amount": v, "color": cat_map.get(k, "#71717a")} for k, v in breakdown.items()]
    breakdown_list.sort(key=lambda x: x["amount"], reverse=True)

    attendance = await db.attendance.find({"date": {"$gte": start, "$lt": next_month}}, {"_id": 0}).to_list(10000)
    attendance_summary = {"present": sum(x["status"] == "Present" for x in attendance), "half_day": sum(x["status"] == "Half Day" for x in attendance), "absent": sum(x["status"] == "Absent" for x in attendance)}
    return {
        "month": period_label,
        "total_spend": total_spend,
        "total_petrol": total_petrol,
        "total_advances": total_advances,
        "cash": cash,
        "upi": upi,
        "cash_upi_ratio": {"cash": cash, "upi": upi},
        "category_breakdown": breakdown_list,
        "expense_count": len(expenses),
        "attendance": attendance_summary,
    }

@api_router.get("/reports/category-spend/export")
async def export_category_spend(month: Optional[str] = None, year: Optional[str] = None, user: User = Depends(get_current_user)):
    if year:
        start, end, label = f"{year}-01-01", f"{int(year)+1}-01-01", year
    elif month:
        y, m = map(int, month.split("-")); start, end, label = f"{month}-01", (f"{y+1}-01-01" if m == 12 else f"{y}-{m+1:02d}-01"), month
    else:
        raise HTTPException(status_code=400, detail="Select a month or year")
    expenses = await db.expenses.find({"date": {"$gte": start, "$lt": end}}, {"_id": 0}).to_list(10000)
    totals = {}
    for expense in expenses: totals[expense["category"]] = totals.get(expense["category"], 0) + expense["amount"]
    buf = io.StringIO(); writer = csv.writer(buf); writer.writerow(["Period", "Category", "Amount (INR)"])
    for category, amount in sorted(totals.items(), key=lambda item: item[1], reverse=True): writer.writerow([label, category, amount])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=category_spend_{label}.csv"})

@api_router.get("/reports/summary")
async def report_summary(start: str, end: str, firm_id: Optional[str] = None, user: User = Depends(get_current_user)):
    q = {"date": {"$gte": start, "$lte": end}}
    if firm_id: q["firm_id"] = firm_id
    expenses = await db.expenses.find(q, {"_id": 0}).to_list(10000)
    tax = await db.tax_entries.find(q, {"_id": 0}).to_list(10000)
    categories = {}
    for e in expenses: categories[e["category"]] = categories.get(e["category"], 0) + e["amount"]
    return {"start": start, "end": end, "expense_total": sum(e["amount"] for e in expenses), "tax_total": sum(t["amount"] for t in tax), "entries": len(expenses), "by_category": categories, "cash": sum(e["amount"] for e in expenses if e["payment_mode"] == "Cash"), "upi": sum(e["amount"] for e in expenses if e["payment_mode"] == "UPI/Bank")}

@api_router.get("/reminders")
async def reminders(user: User = Depends(get_current_user)):
    today = now_utc().date(); due = []
    # Practical GST/advance-tax prompt dates; users still record the actual challan payment.
    for label, month, day in [("GST payment", today.month, 20), ("Advance tax", 6, 15), ("Advance tax", 9, 15), ("Advance tax", 12, 15), ("Advance tax", 3, 15)]:
        year = today.year if month >= today.month else today.year + 1
        d = datetime(year, month, day).date(); delta = (d - today).days
        if 0 <= delta <= 30: due.append({"title": label, "due_date": d.isoformat(), "days_remaining": delta})
    return due

# -------- Payslip --------
@api_router.get("/payslip/{employee_id}")
async def payslip(employee_id: str, user: User = Depends(get_current_user), month: Optional[str] = Query(None)):
    if not month:
        month = now_utc().strftime("%Y-%m")
    emp = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    start = f"{month}-01"
    year, m = map(int, month.split("-"))
    next_month = f"{year+1}-01-01" if m == 12 else f"{year}-{m+1:02d}-01"

    advances = await db.expenses.find(
        {"employee_id": employee_id, "category": "Salary Advance", "date": {"$gte": start, "$lt": next_month}},
        {"_id": 0}
    ).sort("date", 1).to_list(500)

    outstanding = [a for a in advances if not a.get("repaid")]
    repaid = [a for a in advances if a.get("repaid")]
    total_outstanding = sum(a["amount"] for a in outstanding)
    total_repaid = sum(a["amount"] for a in repaid)

    firm = None
    if emp.get("firm_id"):
        firm = await db.firms.find_one({"firm_id": emp["firm_id"]}, {"_id": 0})

    return {
        "month": month,
        "employee": emp,
        "firm": firm,
        "base_salary": emp["base_salary"],
        "total_outstanding_advance": total_outstanding,
        "total_repaid_advance": total_repaid,
        "net_payable": emp["base_salary"] - total_outstanding,
        "advances": advances,
        "generated_at": iso(now_utc()),
        "generated_by": user.name,
    }

# -------- Users (Owner only) --------
@api_router.get("/users")
async def list_users(user: User = Depends(require_owner)):
    docs = await db.users.find({}, {"_id": 0}).to_list(500)
    return docs

class RoleUpdate(BaseModel):
    role: str

@api_router.put("/users/{user_id}/role")
async def update_role(user_id: str, payload: RoleUpdate, user: User = Depends(require_owner)):
    if payload.role not in ("owner", "accountant"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if payload.role == "accountant":
        target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if target and target.get("role") == "owner":
            owner_count = await db.users.count_documents({"role": "owner"})
            if owner_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last remaining owner")
    r = await db.users.update_one({"user_id": user_id}, {"$set": {"role": payload.role}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: User = Depends(require_owner)):
    if user_id == user.user_id:
        raise HTTPException(status_code=400, detail="You cannot remove yourself")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Not found")
    if target.get("role") == "owner":
        owner_count = await db.users.count_documents({"role": "owner"})
        if owner_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last remaining owner")
    await db.users.delete_one({"user_id": user_id})
    await db.user_sessions.delete_many({"user_id": user_id})
    return {"ok": True}

class ResetPayload(BaseModel):
    confirm: str  # must equal "RESET"

# -------- Invitations --------
class InvitationCreate(BaseModel):
    email: str
    role: str  # "owner" | "accountant"

@api_router.get("/invitations")
async def list_invitations(user: User = Depends(require_owner)):
    docs = await db.invitations.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs

@api_router.post("/invitations")
async def create_invitation(payload: InvitationCreate, user: User = Depends(require_owner)):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    if payload.role not in ("owner", "accountant"):
        raise HTTPException(status_code=400, detail="Invalid role")

    # If a user with this email already exists, update their role directly
    existing_user = await db.users.find_one({"email": email}, {"_id": 0})
    if existing_user:
        await db.users.update_one({"user_id": existing_user["user_id"]}, {"$set": {"role": payload.role}})

    # Upsert invitation (for future first-time sign-ins)
    doc = {
        "invitation_id": f"inv_{uuid.uuid4().hex[:10]}",
        "email": email,
        "role": payload.role,
        "invited_by": user.user_id,
        "created_at": iso(now_utc()),
    }
    await db.invitations.update_one(
        {"email": email},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True, "email": email, "role": payload.role, "applied_to_existing_user": bool(existing_user)}

@api_router.delete("/invitations/{email}")
async def delete_invitation(email: str, user: User = Depends(require_owner)):
    r = await db.invitations.delete_one({"email": email.lower()})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@api_router.post("/admin/reset")
async def reset_data(payload: ResetPayload, user: User = Depends(require_owner)):
    """Wipe all business data. Preserves users, sessions, and default categories."""
    if payload.confirm != "RESET":
        raise HTTPException(status_code=400, detail="Confirmation string must be 'RESET'")
    exp = await db.expenses.delete_many({})
    emp = await db.employees.delete_many({})
    tax = await db.tax_entries.delete_many({})
    cat = await db.categories.delete_many({"is_default": {"$ne": True}})
    return {
        "ok": True,
        "deleted": {
            "expenses": exp.deleted_count,
            "employees": emp.deleted_count,
            "tax_entries": tax.deleted_count,
            "custom_categories": cat.deleted_count,
        },
    }

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
