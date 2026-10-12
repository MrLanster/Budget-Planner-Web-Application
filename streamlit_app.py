"""Budget Planner - a Streamlit app with accounts and per-user data.

This is a separate app from the JavaScript one in web/ + server/. It exists so
the planner can be deployed on Streamlit, which runs a single Python script and
nothing else.

It is the *core* of the planner: sign up, sign in, add spending or income
entries, see them listed, and see a monthly summary. The richer pages of the
browser app (roommates, bills, savings, reminders) are not here yet.

Data lives in a database given by DATABASE_URL, which must be a hosted Postgres
on Streamlit Cloud: the Cloud has no persistent disk, so a local file would be
erased on every restart. Locally, with no DATABASE_URL set, it falls back to a
SQLite file next to this script so you can run it without a database server.

Isolation: every row carries the owner's user id, and every query is filtered by
the signed-in user. One Postgres is used, so this is *logical* separation, not
the separate-file-per-user scheme the Node server did.
"""

import hashlib
import hmac
import os
import secrets
from datetime import date, datetime, timezone

import pandas as pd
import streamlit as st
from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    delete,
    insert,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

PAGE_TITLE = "Budget Planner"
MIN_PASSWORD = 8
PBKDF2_ROUNDS = 210_000
CURRENCIES = ["\u20b9", "$", "\u20ac", "\u00a3"]

# One list for both kinds of entry, so the picker never has to change under the
# user's fingers (a Streamlit form cannot restyle itself mid-entry).
CATEGORIES = [
    "Food",
    "Rent",
    "Bills",
    "Transport",
    "Shopping",
    "Health",
    "Fun",
    "Salary",
    "Other",
]

st.set_page_config(page_title=PAGE_TITLE, page_icon="\u20b9", layout="wide")


# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #

metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(255), unique=True, nullable=False),
    Column("name", String(120), nullable=False),
    Column("pw_salt", String(64), nullable=False),
    Column("pw_hash", String(128), nullable=False),
    Column("currency", String(8), nullable=False, default="\u20b9"),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

entries = Table(
    "entries",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, nullable=False, index=True),
    Column("kind", String(16), nullable=False),  # "spend" or "income"
    Column("amount", Float, nullable=False),
    Column("category", String(80), nullable=False),
    Column("note", String(300), nullable=False, default=""),
    Column("entry_date", Date, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)


def utcnow() -> datetime:
    """Aware UTC timestamp. datetime.utcnow() is deprecated in Python 3.12."""
    return datetime.now(timezone.utc)


def database_url() -> str:
    """Postgres from secrets/env on a host; a local SQLite file otherwise."""
    # st.secrets raises when there is no secrets file at all, hence the guard.
    try:
        url = st.secrets.get("DATABASE_URL")
        if url:
            return url
    except Exception:
        pass
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    return "sqlite:///budget_planner.db"


@st.cache_resource(show_spinner=False)
def get_engine(url: str):
    options = {"pool_pre_ping": True, "future": True}
    if url.startswith("sqlite"):
        # Streamlit runs each session on its own thread.
        options["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **options)
    metadata.create_all(engine)
    return engine


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #

def hash_password(password: str):
    """PBKDF2-SHA256 from the standard library, so there is no native dep."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return salt.hex(), digest.hex()


def password_matches(password: str, salt_hex: str, hash_hex: str) -> bool:
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt_hex), PBKDF2_ROUNDS
    )
    return hmac.compare_digest(digest.hex(), hash_hex)


# --------------------------------------------------------------------------- #
# Queries
# --------------------------------------------------------------------------- #

def find_user_by_email(engine, email: str):
    with engine.connect() as conn:
        row = conn.execute(
            select(users).where(users.c.email == email.strip().lower())
        ).first()
        return dict(row._mapping) if row else None


def create_user(engine, name, email, password):
    salt, digest = hash_password(password)
    with engine.begin() as conn:
        result = conn.execute(
            insert(users).values(
                email=email.strip().lower(),
                name=name.strip(),
                pw_salt=salt,
                pw_hash=digest,
                currency=CURRENCIES[0],
                created_at=utcnow(),
            )
        )
        return result.inserted_primary_key[0]


def add_entry(engine, user_id, kind, amount, category, note, when):
    with engine.begin() as conn:
        conn.execute(
            insert(entries).values(
                user_id=user_id,
                kind=kind,
                amount=float(amount),
                category=category,
                note=(note or "").strip(),
                entry_date=when,
                created_at=utcnow(),
            )
        )


def entries_frame(engine, user_id) -> pd.DataFrame:
    with engine.connect() as conn:
        rows = conn.execute(
            select(entries)
            .where(entries.c.user_id == user_id)
            .order_by(entries.c.entry_date.desc(), entries.c.id.desc())
        ).all()
    if not rows:
        return pd.DataFrame(
            columns=["id", "kind", "amount", "category", "note", "entry_date"]
        )
    frame = pd.DataFrame([dict(r._mapping) for r in rows])
    frame["entry_date"] = pd.to_datetime(frame["entry_date"])
    return frame


def remove_entry(engine, user_id, entry_id):
    with engine.begin() as conn:
        conn.execute(
            delete(entries).where(
                (entries.c.id == entry_id) & (entries.c.user_id == user_id)
            )
        )


def set_currency(engine, user_id, symbol):
    with engine.begin() as conn:
        conn.execute(
            update(users).where(users.c.id == user_id).values(currency=symbol)
        )


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def money(value: float, symbol: str) -> str:
    return f"{symbol}{value:,.2f}"


def month_choices(count: int = 12):
    """The last `count` months, newest first, as (year, month)."""
    today = date.today()
    year, month = today.year, today.month
    out = []
    for _ in range(count):
        out.append((year, month))
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return out


def signed_in_user():
    return st.session_state.get("user")


# --------------------------------------------------------------------------- #
# Sign in / create account
# --------------------------------------------------------------------------- #

def auth_screen(engine):
    st.title(f"\u20b9 {PAGE_TITLE}")
    st.caption("Your budget is private to your account.")

    sign_in_tab, create_tab = st.tabs(["Sign in", "Create account"])

    with sign_in_tab:
        with st.form("sign_in"):
            email = st.text_input("Email", key="si_email")
            password = st.text_input("Password", type="password", key="si_password")
            submitted = st.form_submit_button("Sign in", type="primary")
        if submitted:
            user = find_user_by_email(engine, email) if email else None
            if user and password_matches(password, user["pw_salt"], user["pw_hash"]):
                st.session_state["user"] = {
                    "id": user["id"],
                    "name": user["name"],
                    "email": user["email"],
                    "currency": user["currency"],
                }
                st.rerun()
            else:
                # The same message for an unknown email and a wrong password,
                # so this cannot be used to find out who has an account.
                st.error("Email or password is not right.")

    with create_tab:
        with st.form("create_account"):
            name = st.text_input("Your name", key="ca_name")
            email = st.text_input("Email", key="ca_email")
            password = st.text_input(
                "Password", type="password", key="ca_password",
                help=f"At least {MIN_PASSWORD} characters.",
            )
            again = st.text_input("Repeat password", type="password", key="ca_again")
            submitted = st.form_submit_button("Create account", type="primary")
        if submitted:
            if not name.strip():
                st.error("Enter your name.")
            elif "@" not in email or "." not in email:
                st.error("That email address does not look right.")
            elif len(password) < MIN_PASSWORD:
                st.error(f"Use at least {MIN_PASSWORD} characters for your password.")
            elif password != again:
                st.error("The two passwords do not match.")
            elif find_user_by_email(engine, email):
                st.error("An account with that email already exists.")
            else:
                try:
                    user_id = create_user(engine, name, email, password)
                except IntegrityError:
                    # Someone registered the same email in the meantime.
                    st.error("An account with that email already exists.")
                else:
                    st.session_state["user"] = {
                        "id": user_id,
                        "name": name.strip(),
                        "email": email.strip().lower(),
                        "currency": CURRENCIES[0],
                    }
                    st.rerun()


# --------------------------------------------------------------------------- #
# Add an entry
# --------------------------------------------------------------------------- #

def add_panel(engine, user):
    st.subheader("Add an entry")
    with st.form("add_entry", clear_on_submit=True):
        kind_label = st.radio("Type", ["Spending", "Income"], horizontal=True)
        amount = st.number_input("Amount", min_value=0.0, step=10.0, format="%.2f")
        category = st.selectbox("Category", CATEGORIES)
        when = st.date_input("Date", value=date.today())
        note = st.text_input("Note (optional)", max_chars=200)
        submitted = st.form_submit_button("Save entry", type="primary")

    if submitted:
        if amount <= 0:
            st.error("Enter an amount above zero.")
        else:
            add_entry(
                engine,
                user["id"],
                "spend" if kind_label == "Spending" else "income",
                amount,
                category,
                note,
                when,
            )
            st.success(f"Saved {money(amount, user['currency'])} under {category}.")


# --------------------------------------------------------------------------- #
# Monthly summary
# --------------------------------------------------------------------------- #

def summary_panel(engine, user):
    st.subheader("Monthly summary")
    frame = entries_frame(engine, user["id"])
    if frame.empty:
        st.info("Nothing recorded yet. Add your first entry on the Add tab.")
        return

    months = month_choices()
    labels = [f"{date(y, m, 1):%B %Y}" for y, m in months]
    picked = st.selectbox("Month", range(len(months)), format_func=lambda i: labels[i])
    year, month = months[picked]

    in_month = frame[
        (frame["entry_date"].dt.year == year) & (frame["entry_date"].dt.month == month)
    ]
    income = float(in_month.loc[in_month["kind"] == "income", "amount"].sum())
    spent = float(in_month.loc[in_month["kind"] == "spend", "amount"].sum())

    col1, col2, col3 = st.columns(3)
    col1.metric("Income", money(income, user["currency"]))
    col2.metric("Spent", money(spent, user["currency"]))
    net = income - spent
    col3.metric(
        "Net",
        money(net, user["currency"]),
        delta="in the black" if net >= 0 else "over budget",
        delta_color="normal" if net >= 0 else "inverse",
    )

    spending = in_month[in_month["kind"] == "spend"]
    if spending.empty:
        st.caption("No spending recorded this month.")
        return

    by_category = (
        spending.groupby("category")["amount"].sum().sort_values(ascending=False)
    )
    st.write("**Where it went**")
    st.bar_chart(by_category)
    st.dataframe(
        by_category.rename("Amount").to_frame(),
        width="stretch",
    )


# --------------------------------------------------------------------------- #
# Entries list
# --------------------------------------------------------------------------- #

def entries_panel(engine, user):
    st.subheader("Your entries")
    frame = entries_frame(engine, user["id"])
    if frame.empty:
        st.info("No entries yet.")
        return

    shown = frame.copy()
    shown["entry_date"] = shown["entry_date"].dt.strftime("%d %b %Y")
    shown["amount"] = shown.apply(
        lambda r: money(r["amount"], user["currency"]), axis=1
    )
    shown = shown.rename(
        columns={
            "entry_date": "Date",
            "kind": "Type",
            "category": "Category",
            "amount": "Amount",
            "note": "Note",
        }
    )[["Date", "Type", "Category", "Amount", "Note"]]

    st.dataframe(shown, width="stretch", hide_index=True)

    st.download_button(
        "Download as CSV",
        data=shown.to_csv(index=False).encode("utf-8"),
        file_name="budget-entries.csv",
        mime="text/csv",
        width="stretch",
    )

    with st.expander("Delete an entry"):
        # Label every row the same way the table above shows it, then remember
        # the position the user picked rather than the text: two entries can
        # legitimately look identical, and the row's own id is what matters.
        labels = [
            f"{row.entry_date:%d %b %Y} \u00b7 {row.kind} \u00b7 {row.category} "
            f"\u00b7 {money(row.amount, user['currency'])}"
            for row in frame.itertuples()
        ]
        picked = st.selectbox(
            "Entry", range(len(labels)), format_func=lambda i: labels[i],
            key="delete_choice",
        )
        if st.button("Delete this entry"):
            remove_entry(engine, user["id"], int(frame.iloc[picked]["id"]))
            st.rerun()


# --------------------------------------------------------------------------- #
# Signed-in shell
# --------------------------------------------------------------------------- #

def app_screen(engine, user):
    with st.sidebar:
        st.subheader(user["name"])
        st.caption(user["email"])
        choice = st.selectbox(
            "Currency",
            CURRENCIES,
            index=CURRENCIES.index(user["currency"])
            if user["currency"] in CURRENCIES
            else 0,
        )
        if choice != user["currency"]:
            set_currency(engine, user["id"], choice)
            user["currency"] = choice
            st.rerun()

        st.divider()
        if st.button("Sign out"):
            st.session_state.pop("user", None)
            st.rerun()
        st.caption("Budget Planner \u00b7 Streamlit edition")

    st.title(PAGE_TITLE)
    add_tab, summary_tab, entries_tab = st.tabs(["Add", "Summary", "Entries"])
    with add_tab:
        add_panel(engine, user)
    with summary_tab:
        summary_panel(engine, user)
    with entries_tab:
        entries_panel(engine, user)


def main():
    engine = get_engine(database_url())
    user = signed_in_user()
    if user:
        app_screen(engine, user)
    else:
        auth_screen(engine)


main()
