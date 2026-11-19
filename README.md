# SliqDesk – User Guide

SliqDesk is a help desk application for support teams. Each company that uses it is an **organization** with its own members, tickets, notifications and settings, and no organization can see another organization's data. Ticket changes appear live in every open browser, and urgent tickets that wait too long for a reply are flagged automatically.

This guide explains how to start SliqDesk, load the sample data, sign in with the sample accounts, and use every screen.

---

## Contents

1. [Start the application](#1-start-the-application)
2. [Load the sample data](#2-load-the-sample-data)
3. [Sample login credentials](#3-sample-login-credentials)
4. [Key concepts](#4-key-concepts)
5. [Signing up, signing in and signing out](#5-signing-up-signing-in-and-signing-out)
6. [Finding your way around](#6-finding-your-way-around)
7. [Dashboard](#7-dashboard)
8. [Working with tickets](#8-working-with-tickets)
9. [Response-time SLA and overdue tickets](#9-response-time-sla-and-overdue-tickets)
10. [Notifications](#10-notifications)
11. [Managing members (admins)](#11-managing-members-admins)
12. [Settings (admins)](#12-settings-admins)
13. [What each role can do](#13-what-each-role-can-do)
14. [Guided test scenarios](#14-guided-test-scenarios)
15. [Troubleshooting](#15-troubleshooting)
16. [Stopping and resetting](#16-stopping-and-resetting)

---

## 1. Start the application

You need **Docker Desktop** (Windows or macOS) or Docker Engine with the Compose plugin (Linux).

1. In the project folder, create your settings file from the template:

   ```bash
   cp .env.example .env              # Windows PowerShell: Copy-Item .env.example .env
   ```

   Open `.env` and replace `change_me` in **both** `POSTGRES_PASSWORD` and `DB_PASSWORD` with the same password of your choice.

2. Build and start everything:

   ```bash
   docker compose up -d --build
   ```

   The first start takes a few minutes. Run `docker compose ps` and wait until `backend` and `frontend` show **healthy**.

3. Open **http://localhost:3000** in your browser.

If port 3000, 5000 or 5432 is already used by another program, change `FRONTEND_HOST_PORT`, `BACKEND_HOST_PORT` or `POSTGRES_HOST_PORT` in `.env` and run step 2 again. If you change `FRONTEND_HOST_PORT`, open that port instead of 3000.

---

## 2. Load the sample data

A new installation starts with an empty database. To add sample organizations, users and tickets, run this once while the application is running:

```bash
docker compose exec backend npm run seed:demo
```

- It creates **2 organizations, 7 accounts and 7 tickets** (listed below).
- It is safe to run again. If the sample data already exists, it prints `Demo data already present - nothing to do` and changes nothing.
- It refuses to run when `NODE_ENV=production`, because the sample password is public. **Never load sample data into a real deployment.**
- Without Docker (local development): `cd backend` and then `npm run seed:demo`.

---

## 3. Sample login credentials

Every sample account uses the same password: **`Demo@1234`**

| Email | Password | Organization | Role | Use it to test |
|---|---|---|---|---|
| `admin@acme.test` | `Demo@1234` | Acme Corp | Admin | Everything: members, settings, editing any ticket |
| `agent@acme.test` | `Demo@1234` | Acme Corp | Agent | Working on your own tickets (two are assigned to you) |
| `agent2@acme.test` | `Demo@1234` | Acme Corp | Agent | Agent limits: you cannot edit tickets assigned to another agent |
| `viewer@acme.test` | `Demo@1234` | Acme Corp | Viewer | Read-only access |
| `admin@globex.test` | `Demo@1234` | Globex Ltd | Admin | Data separation: you see only Globex data |
| `shared@demo.test` | `Demo@1234` | Acme Corp **and** Globex Ltd | Agent in Acme, Viewer in Globex | Choosing an organization at sign-in |

Names shown in the app: Alice Admin, Andy Agent, Bella Agent, Victor Viewer, Grace Admin and Sam Shared.

### Sample tickets in Acme Corp

| Title | Priority | Status | Assignee | What it demonstrates |
|---|---|---|---|---|
| Customer portal login fails with error 500 | Urgent | Open | Andy Agent | SLA timer running; turns **Overdue** unless an admin or agent replies in time |
| Invoice PDF shows the wrong VAT amount | High | In progress | Andy Agent | SLA met: an agent replied in time |
| CSV export times out for large reports | High | Open | Unassigned | SLA timer running; any agent may pick it up |
| Password reset email not received | Medium | Resolved | Bella Agent | Can be reopened or closed |
| Add a dark mode to the dashboard | Low | Open | Unassigned | Not covered by the SLA (low priority) |
| Update the company logo on the login page | Low | Closed | Bella Agent | Closed tickets are read-only |

Globex Ltd has one ticket: **VPN disconnects every hour** (Medium, Open, assigned to Grace Admin).

> **Timing:** the two tickets with a running SLA timer become overdue **5 minutes after you run the seed command** (the default response time). Within about 30 seconds after that, every Acme member receives an "SLA breached" notification. Sign in right after seeding if you want to watch it happen.

---

## 4. Key concepts

| Term | Meaning |
|---|---|
| **Organization** | A company's private space. Members, tickets, notifications and settings belong to exactly one organization. |
| **Member** | A person with an account in an organization. Each member has one **role**: Admin, Agent or Viewer (see [section 13](#13-what-each-role-can-do)). |
| **Ticket** | A support request with a title, description, priority, status, an optional assignee, and comments. |
| **Priority** | Low, Medium, High or Urgent. High and Urgent tickets are covered by the response-time SLA. |
| **Status** | Open, In progress, Resolved or Closed. Closed is final. |
| **SLA** | The time within which an admin or agent must reply to a High or Urgent ticket. The default is 5 minutes, and an admin can change it. |

How a ticket moves between statuses:

```
  Open  ⇄  In progress
    │           │
    ▼           ▼
       Resolved ──► Open   (reopen)
          │
          ▼
       Closed   (final: no more changes or comments)
```

---

## 5. Signing up, signing in and signing out

### Create a new organization

1. On the sign-in page, click **Create an organization**.
2. Fill in **Organization name**, **Your name**, **Email**, **Password** and **Confirm password**.
   The password must be at least 8 characters long and contain at least one letter and one number.
3. Click **Create organization**. You become the organization's first **admin** and are signed in.

### Sign in

1. Enter your **Email** and **Password**, then click **Sign in**.
2. If the same email and password belong to accounts in more than one organization, an **Organization** list appears. Choose the organization you want and click **Sign in** again.

If you opened a page before signing in, SliqDesk takes you back to that page after you sign in.

### Join through an invitation

1. An admin sends you a one-time invitation link (see [section 11](#11-managing-members-admins)).
2. Open the link. The **Join your team** page shows your name, email, the organization and your role.
3. Enter **Choose a password** and **Confirm password**, then click **Accept invitation**. You are signed in.

An invitation link works once and expires after 72 hours.

### Staying signed in and signing out

- You stay signed in while you use the app. After about an hour without activity, you are asked to sign in again.
- Click **Log out** at the top right to sign out.
- If an admin removes you, you are signed out immediately.
- If an admin changes your role, your screens update immediately to match the new role.

---

## 6. Finding your way around

The bar at the top of every page contains:

| Item | Who sees it | What it does |
|---|---|---|
| **Dashboard** | Everyone | Overview of ticket counts and the latest tickets |
| **Tickets** | Everyone | The full ticket list with filters |
| **New ticket** | Admin, Agent | Create a ticket |
| **Members** | Admin | Invite and manage members |
| **Settings** | Admin | Change the SLA response time |
| Coloured dot | Everyone | **Green**: live updates are connected. **Orange**: reconnecting (this happens automatically). |
| Bell | Everyone | Your notifications, with the number of unread ones |
| Your name, organization and role | Everyone | Shows who is signed in and where |
| **Log out** | Everyone | Signs you out |

If you open a page your role does not allow (for example, a Viewer typing `/settings`), you see an **Access denied** message.

---

## 7. Dashboard

- **Count cards:** Total tickets, Open, In progress, Resolved, Closed and **Overdue**. Click a card to open the ticket list filtered to those tickets.
- **Latest tickets:** the 5 newest tickets. Click a title to open the ticket.
- **+ New ticket** (admins and agents): opens the create form.

The counts and the list update automatically when anyone in your organization creates or changes a ticket.

---

## 8. Working with tickets

### Ticket list

Open **Tickets** in the top bar. Use the filters to narrow the list:

| Filter | Options |
|---|---|
| Status | All, Open, In progress, Resolved, Closed |
| Priority | All, Low, Medium, High, Urgent |
| Assignee | Anyone, Unassigned, or a specific admin or agent |
| Overdue | Any, Overdue only, Not overdue |

- Click **Reset** to clear all filters.
- The list shows 10 tickets per page. Use the page buttons at the bottom to move between pages.
- The filters are kept in the browser address, so you can bookmark or share a filtered view.
- The list updates automatically when tickets change.

### Create a ticket (admins and agents)

1. Click **New ticket**.
2. Fill in **Title** (up to 200 characters) and **Description** (up to 10,000 characters).
3. Choose a **Priority** (the default is Medium) and, optionally, an **Assignee**. Only admins and agents can be assignees.
4. Click **Create ticket**.

If you assign the ticket to someone else, that person receives a notification. A High or Urgent ticket starts its SLA timer as soon as it is created.

### Ticket details

Click a ticket title to open it.

- **Top:** the ticket number and title, plus badges for status, priority and **⚠ Overdue** (if overdue).
- **Main area:** the description and the comments.
- **Side panel:** Assignee, Created by, Created, Last updated, **SLA** status and **SLA deadline**.

### Edit a ticket

1. Click **Edit ticket**. This button appears only if you are allowed to edit the ticket.
2. Change **Title**, **Description**, **Status**, **Priority** or **Assignee**.
3. Click **Save changes**, or **Cancel** to discard your changes.

Who can edit:

- **Admins** can edit any ticket that is not closed.
- **Agents** can edit tickets assigned to them and unassigned tickets. On other tickets they see *"Only the assignee or an admin can edit this ticket."*
- **Viewers** cannot edit tickets.

The **Status** list offers only the allowed next steps:

| Current status | You can change it to |
|---|---|
| Open | In progress, Resolved |
| In progress | Open, Resolved |
| Resolved | Open (reopen), Closed |
| Closed | Nothing: the ticket is final |

- A closed ticket shows *"This ticket is closed and can no longer be modified."*
- If someone else saves the ticket while your edit form is open, your form reloads with their latest values. Check the form before you save.
- If two people save at almost the same moment, the second save is refused with *"The ticket was modified by someone else. Reload and try again."* and the latest version loads, so no change is overwritten by accident. Make your change again and save.

### Comments

- Admins and agents can add comments with the reply box under the comments list. Viewers can read comments but not add them.
- A reply from an admin or agent counts as the **staff response** for the SLA (see [section 9](#9-response-time-sla-and-overdue-tickets)).
- New comments appear immediately for everyone who has the ticket open.
- Closed tickets cannot receive comments.

---

## 9. Response-time SLA and overdue tickets

The SLA checks that urgent work gets a reply in time.

**Which tickets are covered:** priority **High** or **Urgent**, and status **Open** or **In progress**.

**When the timer starts** (deadline = start time + the organization's response time, 5 minutes by default):

- when a ticket is created as High or Urgent;
- when a ticket's priority is raised from Low or Medium to High or Urgent;
- when a resolved ticket is reopened. Reopening also clears the Overdue badge.

**What happens next:**

| Event | Result |
|---|---|
| An admin or agent comments before the deadline | The timer stops. SLA shows **Responded within SLA**. |
| The deadline passes with no admin or agent reply | Within about 30 seconds, the ticket gets the **⚠ Overdue** badge and **every member** of the organization receives an "SLA breached" notification. |
| The ticket is resolved or closed, or its priority is lowered to Low or Medium | The timer stops (**SLA stopped**). An existing Overdue badge stays as history. |
| The priority changes between High and Urgent | Nothing changes. The same timer continues. |

**SLA labels on the ticket page:**

| Label | Meaning |
|---|---|
| Awaiting first staff response | The timer is running. The deadline is shown below the label. |
| Responded within SLA | A staff member replied in time. |
| SLA breached | No staff reply before the deadline. |
| SLA stopped (no longer monitored) | The ticket was resolved, closed or downgraded before a reply. |
| Not monitored (low/medium priority) | The SLA does not apply to this ticket. |

Changing the response time in **Settings** affects only timers that start after the change. Tickets that are already being timed keep their deadline.

---

## 10. Notifications

The bell in the top bar shows how many unread notifications you have. Click it to open the list.

| Type | Who receives it | When |
|---|---|---|
| **SLA** | Every member of the organization | A High or Urgent ticket passed its deadline without a staff reply |
| **Assigned** | The new assignee | Someone else assigned a ticket to you |

- Click a notification to open its ticket. The notification is then marked as read.
- Click **Mark all read** to clear the unread count.
- When a new notification arrives, a short pop-up message appears briefly.
- Each member has their own read status, so reading a notification does not mark it read for anyone else.

---

## 11. Managing members (admins)

Open **Members** in the top bar.

### Invite a member

1. In **Invite a member**, enter **Name** and **Email**, and choose a **Role** (Admin, Agent or Viewer).
2. Click **Send invitation**.
3. No email service is configured, so in development mode the app shows the one-time **invitation link** with a **Copy** button. Send this link to the person. In production mode, the link is not shown on screen.

Invitations that have not been accepted yet appear under **Pending invitations**. Click **Revoke** to cancel one.

### Change a role or remove a member

- **Change role:** pick a new role from the list next to the member. The change takes effect immediately.
- **Remove:** click **Remove** and confirm. The member is signed out immediately, and their tickets become unassigned.

Rules:

- An organization always keeps at least one admin, so the last admin cannot be demoted or removed.
- When a member becomes a **Viewer**, their tickets become unassigned, because viewers cannot work on tickets.
- You cannot invite an email that already belongs to an active member of the organization.

---

## 12. Settings (admins)

Open **Settings** in the top bar.

- **Response time (minutes):** how long admins and agents have to reply to High and Urgent tickets. Enter a whole number from **1 to 43,200** (30 days). The default is **5**.
- Click **Save**. The change applies to SLA timers that start after you save. Existing deadlines do not move.
- **Last changed** shows when the value was last saved.

---

## 13. What each role can do

| Action | Admin | Agent | Viewer |
|---|:-:|:-:|:-:|
| View the dashboard, tickets and comments | ✅ | ✅ | ✅ |
| Receive notifications | ✅ | ✅ | ✅ |
| Create tickets | ✅ | ✅ | ❌ |
| Add comments (counts as an SLA response) | ✅ | ✅ | ❌ |
| Edit tickets that are unassigned or assigned to you | ✅ | ✅ | ❌ |
| Edit any ticket | ✅ | ❌ | ❌ |
| Be assigned to tickets | ✅ | ✅ | ❌ |
| Invite, change and remove members | ✅ | ❌ | ❌ |
| Change the SLA response time | ✅ | ❌ | ❌ |

The server checks every action, not only the screen. Even if someone changes what their browser shows, the server still refuses actions their role does not allow.

---

## 14. Guided test scenarios

These scenarios use the [sample data](#3-sample-login-credentials). To be signed in as two people at once, use a normal window and a private (incognito) window, or two different browsers.

### A. Role-based access

1. Sign in as `viewer@acme.test`.
2. **New ticket**, **Members** and **Settings** do not appear in the top bar.
3. Open any ticket. There is no **Edit ticket** button and no reply box.
4. Type `http://localhost:3000/settings` in the address bar. **Access denied** appears.

### B. Agent editing rules

1. Sign in as `agent2@acme.test` (Bella Agent).
2. Open **Customer portal login fails with error 500**, which is assigned to Andy Agent. There is no **Edit ticket** button.
3. Open **CSV export times out for large reports**, which is unassigned. Click **Edit ticket**, set **Assignee** to Bella Agent and **Status** to In progress, then save.
4. Sign in as `agent@acme.test` in another window. Andy can no longer edit that ticket, because it now belongs to Bella.

### C. SLA breach, live

1. Window 1: sign in as `admin@acme.test`. Window 2: sign in as `agent@acme.test`.
2. Within 5 minutes of seeding (or after creating a new **Urgent** ticket), wait for the deadline shown in the ticket's side panel.
3. Within about 30 seconds after the deadline, both windows show the **⚠ Overdue** badge, a pop-up message and a new **SLA** notification in the bell. The **Overdue** card on the dashboard increases.

> **Tip:** as admin, set **Settings → Response time** to 1 minute to make SLA tests faster. This applies to tickets created after the change.

### D. Meeting the SLA

1. As `admin@acme.test`, create a ticket with priority **Urgent**.
2. As `agent@acme.test`, open that ticket and post a comment before the deadline.
3. The SLA label changes to **Responded within SLA**, and the ticket never becomes overdue.

### E. Organizations are separated

1. Sign in as `admin@globex.test`. You see only the Globex ticket, and only Globex members.
2. In another window, as `admin@acme.test`, open an Acme ticket and copy its address (for example `http://localhost:3000/tickets/52`).
3. Paste that address in the Globex window. The ticket is not found, because Globex cannot see Acme data.

### F. One email in two organizations

1. Sign in with `shared@demo.test` / `Demo@1234`. An **Organization** list appears.
2. Choose **Acme Corp** and sign in. You are an **Agent** and can create tickets.
3. Log out, sign in again and choose **Globex Ltd**. You are a **Viewer** with read-only access.

### G. Inviting a new member

1. As `admin@acme.test`, open **Members** and invite *New Agent*, `newagent@acme.test`, role **Agent**.
2. Click **Copy** next to the invitation link.
3. Open the link in a private window, choose a password, and click **Accept invitation**. You are signed in as an agent of Acme Corp.
4. Back in the admin window, the new member appears under **Active members**.

### H. Ticket workflow

1. As `admin@acme.test`, open **Password reset email not received** (Resolved).
2. Change **Status** to **Open** (reopen) and save. Change it to **Resolved** again, then to **Closed**.
3. The ticket now shows *"This ticket is closed and can no longer be modified."* The edit button and the reply box are gone.

### I. Two people editing the same ticket

1. As `admin@acme.test` (window 1) and `agent@acme.test` (window 2), open **Invoice PDF shows the wrong VAT amount**.
2. Click **Edit ticket** in both windows.
3. Change the title in window 1 and save.
4. The edit form in window 2 reloads with the new title right away, so the agent continues from the latest version instead of overwriting it.

### J. Live updates

Open the same ticket in two windows and add a comment in one. It appears in the other within a second, without reloading.

---

## 15. Troubleshooting

| Problem | What to do |
|---|---|
| `http://localhost:3000` does not open | Run `docker compose ps` and wait until `backend` and `frontend` are **healthy**. If you changed `FRONTEND_HOST_PORT`, use that port. |
| `port is already allocated` when starting | Another program uses the port. Change `FRONTEND_HOST_PORT`, `BACKEND_HOST_PORT` or `POSTGRES_HOST_PORT` in `.env` and start again. |
| **Invalid email or password** with a sample account | The sample data is not loaded. Run `docker compose exec backend npm run seed:demo`. Check the email spelling, and note that the password is case-sensitive: `Demo@1234`. |
| The seed prints `Demo data already present` | The sample data is already there. Nothing to do. |
| The seed fails with `Refusing to seed demo data with NODE_ENV=production` | This is intentional. Sample data with a public password must not be loaded into production. |
| **Too many attempts. Please try again later.** | Too many sign-in attempts from your computer. Wait 15 minutes. |
| The dot in the top bar is orange | Live updates are reconnecting. They resume automatically. If not, refresh the page. |
| A ticket became overdue a little after its deadline | This is normal. Deadlines are checked every 30 seconds. |
| An invitation link does not work | Links work once and expire after 72 hours. Ask an admin to send a new invitation. |
| **502 Bad Gateway** after rebuilding only the backend | Run `docker compose restart frontend`. |

To see what the services are doing, run `docker compose logs -f backend worker`.

---

## 16. Stopping and resetting

```bash
docker compose stop            # stop the app; all data is kept
docker compose start           # start it again

docker compose down            # remove the containers; all data is kept
docker compose up -d           # create and start them again
```

To **erase everything** (all organizations, users, tickets and the sample data) and start fresh:

```bash
docker compose down -v                          # deletes all data; everyone is signed out
docker compose up -d --build                    # starts with an empty database
docker compose exec backend npm run seed:demo   # optional: load the sample data again
```
