"""Tests for OWNER_EMAILS env bootstrap and invitations CRUD."""
import os
import uuid
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://finance-hub-pro-15.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_TOKEN = os.environ.get("TEST_OWNER_TOKEN", "test_token_1785581543050")
OWNER_USER_ID = os.environ.get("TEST_OWNER_USER_ID", "test_owner_1785581543050")
ACC_TOKEN = os.environ.get("TEST_ACC_TOKEN", "test_acc_session_1785581696596")
ACC_USER_ID = os.environ.get("TEST_ACC_USER_ID", "test-acc-1785581696596")

OWNER_EMAIL_ENV = "cks.pratap.enterprises@gmail.com"


def h(token):
    return {"Authorization": f"Bearer {token}"}


def mongo(cmd: str):
    subprocess.run(["mongosh", "--quiet", "--eval", f"use('test_database'); {cmd}"], check=True, capture_output=True)


@pytest.fixture(scope="module")
def owner_h():
    return h(OWNER_TOKEN)


@pytest.fixture(scope="module")
def acc_h():
    return h(ACC_TOKEN)


# ---------- OWNER_EMAILS env bootstrap ----------
class TestOwnerEmailsBootstrap:
    def test_owner_email_env_auto_promotes_on_me(self):
        """Seed a user with role=accountant and email in OWNER_EMAILS. GET /auth/me should return owner and update DB."""
        uid = f"TEST_OE_{uuid.uuid4().hex[:8]}"
        tok = f"TEST_OE_TOK_{uuid.uuid4().hex[:8]}"
        mongo(
            f"db.users.insertOne({{user_id:'{uid}', email:'{OWNER_EMAIL_ENV}', name:'Bootstrap', role:'accountant', created_at:new Date()}});"
            f"db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}', expires_at:new Date(Date.now()+3600*1000)}});"
        )
        try:
            r = requests.get(f"{API}/auth/me", headers=h(tok))
            assert r.status_code == 200, r.text
            assert r.json()["role"] == "owner", r.json()

            # DB should have been updated
            import json
            out = subprocess.run(
                ["mongosh", "--quiet", "--eval",
                 f"use('test_database'); print(db.users.findOne({{user_id:'{uid}'}}).role);"],
                capture_output=True, text=True
            )
            assert "owner" in out.stdout, out.stdout
        finally:
            mongo(f"db.users.deleteOne({{user_id:'{uid}'}}); db.user_sessions.deleteMany({{user_id:'{uid}'}});")

    def test_owner_email_idempotent(self):
        uid = f"TEST_OE_{uuid.uuid4().hex[:8]}"
        tok = f"TEST_OE_TOK_{uuid.uuid4().hex[:8]}"
        mongo(
            f"db.users.insertOne({{user_id:'{uid}', email:'{OWNER_EMAIL_ENV}', name:'Bootstrap', role:'accountant', created_at:new Date()}});"
            f"db.user_sessions.insertOne({{user_id:'{uid}', session_token:'{tok}', expires_at:new Date(Date.now()+3600*1000)}});"
        )
        try:
            for _ in range(3):
                r = requests.get(f"{API}/auth/me", headers=h(tok))
                assert r.status_code == 200
                assert r.json()["role"] == "owner"
        finally:
            mongo(f"db.users.deleteOne({{user_id:'{uid}'}}); db.user_sessions.deleteMany({{user_id:'{uid}'}});")

    def test_other_users_role_unchanged(self, acc_h):
        """A user with a non-env email keeps their existing role after /auth/me."""
        r = requests.get(f"{API}/auth/me", headers=acc_h)
        assert r.status_code == 200
        assert r.json()["role"] == "accountant"
        assert r.json()["email"] != OWNER_EMAIL_ENV


# ---------- Invitations CRUD ----------
class TestInvitationsCRUD:
    def test_accountant_forbidden_on_all(self, acc_h):
        r = requests.get(f"{API}/invitations", headers=acc_h)
        assert r.status_code == 403
        r = requests.post(f"{API}/invitations", json={"email": "x@y.com", "role": "accountant"}, headers=acc_h)
        assert r.status_code == 403
        r = requests.delete(f"{API}/invitations/x@y.com", headers=acc_h)
        assert r.status_code == 403

    def test_create_list_delete_invitation(self, owner_h):
        email = f"test_inv_{uuid.uuid4().hex[:6]}@example.com"
        try:
            r = requests.post(f"{API}/invitations", json={"email": email, "role": "accountant"}, headers=owner_h)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["email"] == email
            assert data["role"] == "accountant"
            assert data["applied_to_existing_user"] is False

            r = requests.get(f"{API}/invitations", headers=owner_h)
            assert r.status_code == 200
            assert any(i["email"] == email and i["role"] == "accountant" for i in r.json())

            r = requests.delete(f"{API}/invitations/{email}", headers=owner_h)
            assert r.status_code == 200
            r = requests.get(f"{API}/invitations", headers=owner_h)
            assert not any(i["email"] == email for i in r.json())
        finally:
            requests.delete(f"{API}/invitations/{email}", headers=owner_h)

    def test_invalid_email_and_role(self, owner_h):
        r = requests.post(f"{API}/invitations", json={"email": "notanemail", "role": "accountant"}, headers=owner_h)
        assert r.status_code == 400
        r = requests.post(f"{API}/invitations", json={"email": "ok@ok.com", "role": "bogus"}, headers=owner_h)
        assert r.status_code == 400

    def test_invitation_upsert_replaces(self, owner_h):
        email = f"test_ups_{uuid.uuid4().hex[:6]}@example.com"
        try:
            r = requests.post(f"{API}/invitations", json={"email": email, "role": "accountant"}, headers=owner_h)
            assert r.status_code == 200
            r = requests.post(f"{API}/invitations", json={"email": email, "role": "owner"}, headers=owner_h)
            assert r.status_code == 200
            r = requests.get(f"{API}/invitations", headers=owner_h)
            matches = [i for i in r.json() if i["email"] == email]
            assert len(matches) == 1
            assert matches[0]["role"] == "owner"
        finally:
            requests.delete(f"{API}/invitations/{email}", headers=owner_h)

    def test_invitation_updates_existing_user_role(self, owner_h):
        """If invited email already belongs to a user, their role is updated immediately."""
        uid = f"TEST_INVU_{uuid.uuid4().hex[:8]}"
        email = f"test_iu_{uuid.uuid4().hex[:6]}@example.com"
        mongo(f"db.users.insertOne({{user_id:'{uid}', email:'{email}', name:'ExUser', role:'accountant', created_at:new Date()}});")
        try:
            r = requests.post(f"{API}/invitations", json={"email": email, "role": "owner"}, headers=owner_h)
            assert r.status_code == 200
            assert r.json()["applied_to_existing_user"] is True

            r = requests.get(f"{API}/users", headers=owner_h)
            u = next(x for x in r.json() if x["user_id"] == uid)
            assert u["role"] == "owner"
        finally:
            requests.delete(f"{API}/invitations/{email}", headers=owner_h)
            mongo(f"db.users.deleteOne({{user_id:'{uid}'}});")

    def test_invitation_delete_nonexistent(self, owner_h):
        r = requests.delete(f"{API}/invitations/nonexistent_{uuid.uuid4().hex[:6]}@x.com", headers=owner_h)
        assert r.status_code == 404

    def test_invitation_applied_on_session_for_new_email(self, owner_h):
        """When a new user signs in whose email has an invitation, that role is applied.
        We can't hit real /auth/session (external OAuth). Simulate by verifying _resolve_role_for indirectly:
        seed no user, add invitation, create user manually with default acct role, then verify /auth/me changes only if OWNER_EMAILS env; else invitation is applied on process_session (untestable without OAuth).
        Instead, verify the invitation row is present and picked up when the existing-user path fires (covered above).
        """
        # Covered by test_invitation_updates_existing_user_role; here just verify invitation persists correctly
        email = f"test_new_{uuid.uuid4().hex[:6]}@example.com"
        try:
            r = requests.post(f"{API}/invitations", json={"email": email, "role": "owner"}, headers=owner_h)
            assert r.status_code == 200
            r = requests.get(f"{API}/invitations", headers=owner_h)
            match = next((i for i in r.json() if i["email"] == email), None)
            assert match is not None and match["role"] == "owner"
        finally:
            requests.delete(f"{API}/invitations/{email}", headers=owner_h)
