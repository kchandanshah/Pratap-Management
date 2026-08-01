# Auth Testing Playbook (Emergent Google Auth)

## Step 1: Create Test User & Session
```
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.owner.' + Date.now() + '@example.com',
  name: 'Test Owner',
  picture: 'https://via.placeholder.com/150',
  role: 'owner',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Backend curl tests
```
curl -X GET "$URL/api/auth/me" -H "Authorization: Bearer YOUR_SESSION_TOKEN"
curl -X GET "$URL/api/expenses" -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

## Step 3: Browser session cookie
```python
await page.context.add_cookies([{
    "name": "session_token",
    "value": "YOUR_SESSION_TOKEN",
    "domain": "your-app.com",
    "path": "/",
    "httpOnly": True, "secure": True, "sameSite": "None"
}])
```

## Checklist
- user_id is custom UUID, {"_id": 0} projection used everywhere
- /api/auth/me returns user with role
- Dashboard loads without redirect
- Role-based routes: owner can delete, accountant cannot
