from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, Query
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import csv
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

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
]

async def ensure_defaults():
    count = await db.categories.count_documents({})
    if count == 0:
        for c in DEFAULT_CATEGORIES:
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
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
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

@api_router.post("/auth/session")
async def process_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")

    async with httpx.AsyncClient() as c:
        r = await c.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
            timeout=15.0,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session_id")
        data = r.json()

    email = data["email"]
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        # Recompute role — OWNER_EMAILS env should always take precedence
        role = await _resolve_role_for(email, existing["role"])
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data["name"], "picture": data.get("picture"), "role": role}},
        )
    else:
        role = await _resolve_role_for(email)
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data["name"],
            "picture": data.get("picture"),
            "role": role,
            "created_at": iso(now_utc()),
        })

    session_token = data["session_token"]
    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": iso(expires_at),
        "created_at": iso(now_utc()),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    return {"user_id": user_id, "email": email, "name": data["name"], "picture": data.get("picture"), "role": role}

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
        await db.user_sessions.delete_one({"session_token": token})
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

class ExpenseUpdate(BaseModel):
    date: Optional[str] = None
    vendor: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    payment_mode: Optional[str] = None
    notes: Optional[str] = None
    employee_id: Optional[str] = None
    firm_id: Optional[str] = None

@api_router.get("/expenses")
async def list_expenses(
    user: User = Depends(get_current_user),
    category: Optional[str] = None,
    payment_mode: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    firm_id: Optional[str] = None,
    limit: int = 500,
):
    q = {}
    if category:
        q["category"] = category
    if payment_mode:
        q["payment_mode"] = payment_mode
    if firm_id:
        q["firm_id"] = firm_id
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
            "net_payable": float(e["base_salary"]) - advances,
            "advance_entries": advances_list,
        })
    return {"month": month, "employees": result}

# -------- Dashboard --------
@api_router.get("/dashboard")
async def dashboard(user: User = Depends(get_current_user), month: Optional[str] = Query(None)):
    if not month:
        month = now_utc().strftime("%Y-%m")
    start = f"{month}-01"
    year, m = map(int, month.split("-"))
    if m == 12:
        next_month = f"{year+1}-01-01"
    else:
        next_month = f"{year}-{m+1:02d}-01"

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

    return {
        "month": month,
        "total_spend": total_spend,
        "total_petrol": total_petrol,
        "total_advances": total_advances,
        "cash": cash,
        "upi": upi,
        "cash_upi_ratio": {"cash": cash, "upi": upi},
        "category_breakdown": breakdown_list,
        "expense_count": len(expenses),
    }

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
