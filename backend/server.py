"""Daman-style premium gaming platform backend.

Features:
- Mobile OTP auth (dev-mode fallback + Twilio real SMS when configured)
- JWT sessions
- Wallet, deposits, withdrawals, transactions
- Games engine (38% win / 62% loss controlled server-side)
- Promotions, VIP, notifications, support tickets
- Admin: users, deposits, withdrawals, QR/UPI, payment settings, broadcasts, reports
"""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request
from fastapi.security import HTTPBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
import asyncio
import io
import base64
import random
import secrets
import string
import uuid
import bcrypt
import jwt
import qrcode
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ------- Config -------
mongo_url = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = os.environ.get("JWT_ALGO", "HS256")
JWT_EXPIRES_HOURS = int(os.environ.get("JWT_EXPIRES_HOURS", "720"))
ADMIN_SEED_PHONE = os.environ["ADMIN_SEED_PHONE"]
ADMIN_SEED_PASSWORD = os.environ["ADMIN_SEED_PASSWORD"]
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_VERIFY_SERVICE = os.environ.get("TWILIO_VERIFY_SERVICE", "")
PLAYER_WIN_RATE = float(os.environ.get("PLAYER_WIN_RATE", "0.38"))

client = AsyncIOMotorClient(mongo_url)
db = client[DB_NAME]

app = FastAPI(title="Daman Gaming API")

print("🔥🔥🔥 UPDATED BACKEND VERSION 2026-09-29 🔥🔥🔥")

api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("daman")

# ------- Helpers -------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def clean(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    doc.pop("_id", None)
    return doc


def make_uid() -> str:
    """Short numeric UID displayed on user profile e.g. DG1234567."""
    return "DG" + "".join(secrets.choice(string.digits) for _ in range(7))


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(subject: str, role: str) -> str:
    payload = {
        "sub": subject,
        "role": role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRES_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    if payload.get("role") != "user":
        raise HTTPException(403, "Not a user token")
    user = clean(await db.users.find_one({"id": payload["sub"]}))
    if not user:
        raise HTTPException(404, "User not found")
    return user


async def get_current_admin(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    if payload.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    admin = clean(await db.admins.find_one({"id": payload["sub"]}))
    if not admin:
        raise HTTPException(404, "Admin not found")
    return admin


# ------- Twilio helpers -------
_twilio_enabled = bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE)
_twilio_client = None
if _twilio_enabled:
    try:
        from twilio.rest import Client as TwilioClient
        _twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    except Exception as e:
        logger.warning(f"Twilio init failed, fallback to dev-mode OTP: {e}")
        _twilio_enabled = False


def gen_otp() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(6))


# ------- Models -------
class SendOtpIn(BaseModel):
    phone: str


class VerifyOtpIn(BaseModel):
    phone: str
    otp: str
    name: Optional[str] = None
    referral: Optional[str] = None


class AdminLoginIn(BaseModel):
    phone: str
    password: str


class PlayGameIn(BaseModel):
    game_type: str  # crash | aviator | dice | spin | generic
    bet_amount: float
    params: Dict[str, Any] = Field(default_factory=dict)


# Interactive crash/aviator round
class CrashStartIn(BaseModel):
    bet_amount: float
    game_type: str = "crash"  # crash | aviator
    auto_cash_out: Optional[float] = None

class LiveCrashBetIn(BaseModel):
    bet_amount: float
    auto_cash_out: Optional[float] = None    


class CrashCashoutIn(BaseModel):
    round_id: str
    multiplier: float


class CrashSettleIn(BaseModel):
    round_id: str


# Shared multiplier curve: m(t) = 1 + A*t + B*t^2  (t in seconds)
DECK_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
DECK_SUITS = ["♠️", "♥️", "♦️", "♣️"]

def random_card():
    return {"rank": random.choice(DECK_RANKS), "suit": random.choice(DECK_SUITS)}
TEENPATTI_RANK_ORDER = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"]
TEENPATTI_HAND_SCORE = {"Trail": 5, "Pure Sequence": 4, "Sequence": 3, "Color": 2, "Pair": 1, "High Card": 0}

def deal_teenpatti_cards():
    deck = [{"rank": r, "suit": s} for r in DECK_RANKS for s in DECK_SUITS]
    random.shuffle(deck)
    return deck[:3], deck[3:6]

def teenpatti_hand_type(cards):
    vals = sorted(TEENPATTI_RANK_ORDER.index(c["rank"]) + 2 for c in cards)
    suits = {c["suit"] for c in cards}
    is_flush = len(suits) == 1
    is_trail = vals[0] == vals[1] == vals[2]
    is_seq = (vals[2] - vals[1] == 1 and vals[1] - vals[0] == 1) or vals == [2, 3, 14]  # A-2-3 special case
    if is_trail:
        return "Trail"
    if is_seq and is_flush:
        return "Pure Sequence"
    if is_seq:
        return "Sequence"
    if is_flush:
        return "Color"
    if vals[0] == vals[1] or vals[1] == vals[2]:
        return "Pair"
    return "High Card"

CRASH_A = 0.35
CRASH_B = 0.09


def crash_multiplier_at(elapsed_s: float) -> float:
    return round(1.0 + CRASH_A * elapsed_s + CRASH_B * elapsed_s * elapsed_s, 2)


# ---- Win Go (color prediction) ----
class WinGoBetIn(BaseModel):
    duration: int = 60           # 30 | 60 | 180 | 300
    bet_type: str                # color | number | size
    value: str                   # green|violet|red | 0..9 | big|small
    amount: float


def wingo_color_of(n: int) -> List[str]:
    if n == 0:
        return ["violet", "red"]
    if n == 5:
        return ["violet", "green"]
    if n in (1, 3, 7, 9):
        return ["green"]
    return ["red"]


def wingo_size_of(n: int) -> str:
    return "big" if n >= 5 else "small"


def wingo_bet_wins(bet_type: str, value: str, n: int) -> bool:
    if bet_type == "color":
        return value in wingo_color_of(n)
    if bet_type == "number":
        return str(n) == str(value)
    if bet_type == "size":
        return value == wingo_size_of(n)
    return False


def wingo_multiplier(bet_type: str, value: str, n: int) -> float:
    if bet_type == "color":
        return 4.5 if value == "violet" else 2.0
    if bet_type == "number":
        return 9.0
    if bet_type == "size":
        return 2.0
    return 0.0


def wingo_period_info(duration: int):
    now = datetime.now(timezone.utc)
    epoch = now.timestamp()
    idx = int(epoch // duration)
    start = idx * duration
    time_left = int(duration - (epoch - start))
    dt = datetime.fromtimestamp(start, tz=timezone.utc)
    display = f"{dt:%Y%m%d}{(idx % 10000):04d}"
    return idx, time_left, display


async def wingo_ensure_result(duration: int, period_idx: int) -> int:
    """Return the result number for an ENDED period, generating a random one for display if absent."""
    doc = await db.wingo_results.find_one({"duration": duration, "period": period_idx})
    if doc:
        return doc["number"]
    n = random.randint(0, 9)
    await db.wingo_results.insert_one({"duration": duration, "period": period_idx, "number": n, "created_at": now_iso()})
    return n



class DepositCreate(BaseModel):
    amount: float
    utr: str
    method: str = "upi"  # upi | qr


class WithdrawCreate(BaseModel):
    amount: float
    method: str = "upi"  # upi | bank
    upi_id: Optional[str] = None
    account_name: str
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None


class SupportTicketIn(BaseModel):
    subject: str
    message: str


class BroadcastIn(BaseModel):
    title: str
    body: str


class UpsertPaymentConfigIn(BaseModel):
    upi_ids: List[str] = Field(default_factory=list)
    qr_data: Optional[str] = None  # UPI URI string. Backend renders PNG.
    min_deposit: float = 100
    min_withdraw: float = 200
    max_withdraw: float = 100000
    player_win_rate: Optional[float] = None
    welcome_bonus: Optional[float] = None


# ------- Startup: seed -------
@app.on_event("startup")
async def startup():
    # Ensure a user can only enter each fantasy contest once.
    await db.fantasy_entries.create_index([("contest_id", 1), ("user_id", 1)], unique=True)
    await db.fantasy_prize_payouts.create_index("payout_key", unique=True)

    # Seed admin
    existing = await db.admins.find_one({"phone": ADMIN_SEED_PHONE})
    if not existing:
        await db.admins.insert_one({
            "id": new_id(),
            "phone": ADMIN_SEED_PHONE,
            "name": "Super Admin",
            "password_hash": hash_password(ADMIN_SEED_PASSWORD),
            "created_at": now_iso(),
        })
        logger.info(f"Seeded admin: {ADMIN_SEED_PHONE}")

    # Seed payment settings
    if not await db.payment_config.find_one({"id": "default"}):
        upi_uri = "upi://pay?pa=daman@upi&pn=Daman%20Gaming&cu=INR"
        await db.payment_config.insert_one({
            "id": "default",
            "upi_ids": ["daman@upi", "damanpay@okhdfcbank"],
            "qr_data": upi_uri,
            "min_deposit": 100,
            "min_withdraw": 200,
            "max_withdraw": 100000,
            "player_win_rate": PLAYER_WIN_RATE,
            "updated_at": now_iso(),
        })

    # Seed promotions
    if await db.promotions.count_documents({}) == 0:
        await db.promotions.insert_many([
            {"id": new_id(), "title": "First Deposit 100% Bonus", "subtitle": "Get up to ₹5,000 on your first top-up", "code": "FIRST100", "active": True, "created_at": now_iso()},
            {"id": new_id(), "title": "Refer & Earn ₹250", "subtitle": "Invite friends and both earn instantly", "code": "REFER250", "active": True, "created_at": now_iso()},
            {"id": new_id(), "title": "Weekend Cashback 15%", "subtitle": "Every Sat & Sun on total wagers", "code": "WEEKEND15", "active": True, "created_at": now_iso()},
        ])

    # Seed VIP tiers
    if await db.vip_tiers.count_documents({}) == 0:
        await db.vip_tiers.insert_many([
            {"id": "bronze", "name": "Bronze", "min_wager": 0, "cashback": 2, "perks": ["Daily bonus", "Basic support"], "color": "#CD7F32"},
            {"id": "silver", "name": "Silver", "min_wager": 25000, "cashback": 5, "perks": ["Weekly bonus", "Priority support", "Free spins"], "color": "#C0C0C0"},
            {"id": "gold", "name": "Gold", "min_wager": 100000, "cashback": 8, "perks": ["Daily cashback", "Dedicated manager", "Higher limits"], "color": "#FFD700"},
            {"id": "platinum", "name": "Platinum", "min_wager": 500000, "cashback": 12, "perks": ["VIP events", "Exclusive tournaments", "Custom limits"], "color": "#E5E4E2"},
        ])

    asyncio.create_task(live_round_loop())
    asyncio.create_task(dragon_tiger_loop())
    # Periodically settle completed fantasy contests even if nobody opens leaderboard.
    asyncio.create_task(fantasy_settlement_loop()) 


async def get_win_rate(game: Optional[str] = None) -> float:
    cfg = await db.payment_config.find_one({"id": "default"}) or {}
    game_rates = cfg.get("game_win_rates", {})
    if game and game in game_rates:
        return float(game_rates[game])
    return float(cfg.get("player_win_rate", PLAYER_WIN_RATE))

# =========================================================
# LIVE SYNCHRONIZED CRASH ROUND (global, all players share it)
# =========================================================
LIVE_WAIT_SECONDS = 5
LIVE_CRASH_PAUSE_SECONDS = 3


async def live_round_loop():
    """Runs forever in the background. One global round at a time."""
    while True:
        try:
            win_rate = await get_win_rate("crash")
            winnable = random.random() < win_rate
            if winnable:
                crash_point = round(random.uniform(1.30, 12.0), 2)
            else:
                crash_point = round(random.uniform(1.00, 1.25), 2)

            round_id = new_id()
            wait_ends = datetime.now(timezone.utc) + timedelta(seconds=LIVE_WAIT_SECONDS)
            await db.crash_live.update_one(
                {"id": "live"},
                {"$set": {
                    "id": "live",
                    "round_id": round_id,
                    "status": "waiting",
                    "wait_ends_at": wait_ends.isoformat(),
                    "crash_point": crash_point,
                }},
                upsert=True,
            )
            await asyncio.sleep(LIVE_WAIT_SECONDS)

            started_at = datetime.now(timezone.utc)
            await db.crash_live.update_one(
                {"id": "live"},
                {"$set": {"status": "flying", "started_at": started_at.isoformat()}},
            )
            elapsed = 0.0
            while crash_multiplier_at(elapsed) < crash_point:
                await asyncio.sleep(0.1)
                elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()

            await db.crash_live.update_one(
                {"id": "live"},
                {"$set": {"status": "crashed"}},
            )
            await asyncio.sleep(LIVE_CRASH_PAUSE_SECONDS)
        except Exception as e:
            logger.error(f"live_round_loop error: {e}")
            await asyncio.sleep(2) 

DT_WAIT_SECONDS = 20
DT_RESULT_PAUSE_SECONDS = 10


async def dragon_tiger_loop():
    """Global Dragon Tiger round — same style as crash live round."""
    while True:
        try:
            round_id = new_id()
            wait_ends = datetime.now(timezone.utc) + timedelta(seconds=DT_WAIT_SECONDS)
            await db.dt_live.update_one(
                {"id": "live"},
                {"$set": {"id": "live", "round_id": round_id, "status": "waiting", "wait_ends_at": wait_ends.isoformat()}},
                upsert=True,
            )
            await asyncio.sleep(DT_WAIT_SECONDS)

            win_rate = await get_win_rate("dragon-tiger")
            rank_values = {r: i for i, r in enumerate(DECK_RANKS, start=1)}
            dragon_card = random_card()
            tiger_card = random_card()
            while rank_values[tiger_card["rank"]] == rank_values[dragon_card["rank"]]:
                tiger_card = random_card()
            winner = "dragon" if rank_values[dragon_card["rank"]] > rank_values[tiger_card["rank"]] else "tiger"

            await db.dt_live.update_one(
                {"id": "live"},
                {"$set": {"status": "revealed", "dragon_card": dragon_card, "tiger_card": tiger_card, "winner": winner}},
            )

            bets = await db.dt_live_bets.find({"round_id": round_id}).to_list(10000)
            for b in bets:
                win = b["pick"] == winner
                payout = round(b["bet"] * 1.9, 2) if win else 0.0
                if payout > 0:
                    await db.users.update_one({"id": b["user_id"]}, {"$inc": {"balance": payout}})
                    await add_transaction(b["user_id"], "win", payout, {"game": "dragon-tiger", "winner": winner})
                await db.dt_live_bets.update_one({"id": b["id"]}, {"$set": {"settled": True, "win": win, "payout": payout}})

            await asyncio.sleep(DT_RESULT_PAUSE_SECONDS)
        except Exception as e:
            logger.error(f"dragon_tiger_loop error: {e}")
            await asyncio.sleep(2)       


async def add_transaction(user_id: str, kind: str, amount: float, meta: dict, status: str = "completed") -> dict:
    tx = {
        "id": new_id(),
        "user_id": user_id,
        "kind": kind,  # deposit | withdraw | bet | win | bonus | refund
        "amount": amount,
        "status": status,
        "meta": meta,
        "created_at": now_iso(),
    }
    await db.transactions.insert_one(tx)
    tx.pop("_id", None)
    return tx


# =========================================================
# AUTH
# =========================================================
@api.post("/auth/send-otp")
async def send_otp(payload: SendOtpIn):
    phone = payload.phone.strip()
    if not phone.startswith("+") or len(phone) < 8:
        raise HTTPException(400, "Phone must be in E.164 (e.g. +919999999999)")

    otp = gen_otp()
    # store OTP with 5-min expiry
    await db.otps.update_one(
        {"phone": phone},
        {"$set": {"phone": phone, "otp": otp, "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(), "created_at": now_iso()}},
        upsert=True,
    )

    if _twilio_enabled:
        try:
            _twilio_client.verify.v2.services(TWILIO_VERIFY_SERVICE).verifications.create(to=phone, channel="sms")
            return {"success": True, "dev_mode": False}
        except Exception as e:
            logger.error(f"Twilio failure, falling back to dev OTP: {e}")

    # dev-mode: return OTP directly (visible for testing)
    logger.info(f"DEV OTP for {phone}: {otp}")
    return {"success": True, "dev_mode": True, "otp": otp}


@api.post("/auth/verify-otp")
async def verify_otp(payload: VerifyOtpIn):
    phone = payload.phone.strip()
    if _twilio_enabled:
        try:
            check = _twilio_client.verify.v2.services(TWILIO_VERIFY_SERVICE).verification_checks.create(to=phone, code=payload.otp)
            if check.status != "approved":
                raise HTTPException(400, "Invalid OTP")
        except HTTPException:
            raise
        except Exception:
            # fall through to local OTP check
            pass

    # local (dev) OTP check
    rec = await db.otps.find_one({"phone": phone})
    if not _twilio_enabled:
        if not rec or rec.get("otp") != payload.otp:
            raise HTTPException(400, "Invalid OTP")
        if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(400, "OTP expired")

    # find or create user
   # find or create user
    user = clean(await db.users.find_one({"phone": phone}))
    if not user:
        cfg = await db.payment_config.find_one({"id": "default"}) or {}
        welcome_bonus = float(cfg.get("welcome_bonus", 50.0))
        user = {
            "id": new_id(),
            "phone": phone,
            "uid": make_uid(),
            "name": payload.name or f"Player{secrets.randbelow(9999)}",
            "avatar": None,
            "balance": welcome_bonus,
            "bonus_balance": welcome_bonus,
            "vip_tier": "bronze",
            "total_wagered": 0.0,
            "referral_code": secrets.token_urlsafe(6),
            "referred_by": payload.referral,
            "created_at": now_iso(),
            "last_login": now_iso(),
        }
        await db.users.insert_one(user.copy())
        await add_transaction(user["id"], "bonus", welcome_bonus, {"note": "Welcome bonus"})
        await db.notifications.insert_one({
            "id": new_id(),
            "user_id": user["id"],
            "title": "Welcome to Daman Gaming!",
            "body": f"₹{welcome_bonus:.0f} welcome bonus has been credited to your wallet.",
            "read": False,
            "created_at": now_iso(),
        })
    else:
        await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})

    await db.otps.delete_many({"phone": phone})
    token = create_token(user["id"], "user")
    return {"success": True, "token": token, "user": clean(await db.users.find_one({"id": user["id"]}))}


# =========================================================
# USER / PROFILE
# =========================================================
@api.get("/me")
async def get_me(user=Depends(get_current_user)):
    return user


@api.patch("/me")
async def update_me(payload: Dict[str, Any], user=Depends(get_current_user)):
    allowed = {k: v for k, v in payload.items() if k in {"name", "avatar", "email"}}
    if allowed:
        await db.users.update_one({"id": user["id"]}, {"$set": allowed})
    return clean(await db.users.find_one({"id": user["id"]}))


# =========================================================
# WALLET / TRANSACTIONS
# =========================================================
@api.get("/wallet")
async def wallet(user=Depends(get_current_user)):
    return {"balance": user["balance"], "bonus_balance": user.get("bonus_balance", 0.0), "vip_tier": user["vip_tier"]}


@api.get("/wallet/transactions")
async def transactions(user=Depends(get_current_user), kind: Optional[str] = None, limit: int = 100):
    q: dict = {"user_id": user["id"]}
    if kind:
        q["kind"] = kind
    docs = await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return docs


# =========================================================
# DEPOSITS
# =========================================================
@api.get("/payment/config")
async def public_payment_config():
    cfg = clean(await db.payment_config.find_one({"id": "default"})) or {}
    # generate QR PNG (base64) from qr_data
    qr_data = cfg.get("qr_data") or ""
    qr_png_b64 = ""
    if qr_data:
        img = qrcode.make(qr_data)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_png_b64 = base64.b64encode(buf.getvalue()).decode()
    return {
        "upi_ids": cfg.get("upi_ids", []),
        "qr_data": qr_data,
        "qr_png_base64": qr_png_b64,
        "min_deposit": cfg.get("min_deposit", 100),
        "min_withdraw": cfg.get("min_withdraw", 200),
        "max_withdraw": cfg.get("max_withdraw", 100000),
    }


@api.post("/deposits")
async def create_deposit(payload: DepositCreate, user=Depends(get_current_user)):
    cfg = await db.payment_config.find_one({"id": "default"}) or {}
    if payload.amount < cfg.get("min_deposit", 100):
        raise HTTPException(400, f"Minimum deposit is ₹{cfg.get('min_deposit', 100)}")
    if not payload.utr or len(payload.utr) < 4:
        raise HTTPException(400, "Please provide a valid UTR / reference number")
    dep = {
        "id": new_id(),
        "user_id": user["id"],
        "user_phone": user["phone"],
        "user_name": user["name"],
        "amount": payload.amount,
        "utr": payload.utr,
        "method": payload.method,
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.deposits.insert_one(dep.copy())
    dep.pop("_id", None)
    return dep


@api.get("/deposits/mine")
async def my_deposits(user=Depends(get_current_user)):
    return await db.deposits.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


# =========================================================
# WITHDRAWALS
# =========================================================
@api.post("/withdrawals")
async def create_withdraw(payload: WithdrawCreate, user=Depends(get_current_user)):
    cfg = await db.payment_config.find_one({"id": "default"}) or {}
    if payload.amount <= 0:
        raise HTTPException(400, "Withdrawal amount must be greater than zero")
    if payload.amount < cfg.get("min_withdraw", 200):
        raise HTTPException(400, f"Minimum withdrawal is ₹{cfg.get('min_withdraw', 200)}")
    if payload.amount > cfg.get("max_withdraw", 100000):
        raise HTTPException(400, f"Maximum withdrawal is ₹{cfg.get('max_withdraw', 100000)}")
    if payload.amount > user["balance"]:
        raise HTTPException(400, "Insufficient balance")
    method = (payload.method or "upi").lower()
    if method not in {"upi", "bank"}:
        raise HTTPException(400, "Withdrawal method must be upi or bank")
    if not payload.account_name.strip():
        raise HTTPException(400, "Account holder name is required")
    payout_details: Dict[str, Any]
    if method == "upi":
        upi_id = (payload.upi_id or "").strip()
        if "@" not in upi_id or len(upi_id) > 100:
            raise HTTPException(400, "Valid UPI ID is required")
        payout_details = {"method": "upi", "upi_id": upi_id}
    else:
        account_number = (payload.account_number or "").strip()
        if not account_number.isdigit() or not (8 <= len(account_number) <= 18):
            raise HTTPException(400, "Bank account number must contain 8 to 18 digits")
        if not (payload.ifsc_code or "").strip().upper() or not __import__("re").fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", payload.ifsc_code.strip().upper()):
            raise HTTPException(400, "Valid IFSC code is required")
        payout_details = {"method": "bank", "account_number": account_number, "ifsc_code": payload.ifsc_code.strip().upper()}
    # Lock funds when the request is created. Rejected requests are refunded by admin action.
    updated = await db.users.update_one(
        {"id": user["id"], "balance": {"$gte": payload.amount}},
        {"$inc": {"balance": -payload.amount}},
    )
    if not updated.modified_count:
        raise HTTPException(400, "Insufficient balance")
    w = {
        "id": new_id(),
        "user_id": user["id"],
        "user_phone": user["phone"],
        "user_name": user["name"],
        "amount": payload.amount,
        "method": method,
        **payout_details,
        "account_name": payload.account_name.strip(),
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.withdrawals.insert_one(w.copy())
    tx_details = {k: v for k, v in payout_details.items() if k in {"method", "upi_id", "ifsc_code"}}
    tx_details.update({"status": "pending", "account_name": payload.account_name.strip()})
    await add_transaction(user["id"], "withdraw", -payload.amount, tx_details, status="pending")
    w.pop("_id", None)
    return w


@api.get("/withdrawals/mine")
async def my_withdrawals(user=Depends(get_current_user)):
    return await db.withdrawals.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


# =========================================================
# GAMES (all 38% win / 62% loss)
# =========================================================
GAME_CATEGORIES = [
    {"id": "crash", "name": "Crash Games", "icon": "rocket", "color": "#FF6B6B", "playable": True},
    {"id": "aviator", "name": "Aviator", "icon": "airplane", "color": "#FF9A9E", "playable": True},
    {"id": "dice", "name": "Dice Games", "icon": "dice", "color": "#FFB020", "playable": True},
    {"id": "spin", "name": "Spin Games", "icon": "target", "color": "#2ECA7F", "playable": True},
    {"id": "cards", "name": "Card Games", "icon": "cards", "color": "#4A4A4A", "playable": False},
    {"id": "number", "name": "Number Games", "icon": "grid", "color": "#FF7E67", "playable": False},
    {"id": "arcade", "name": "Arcade Games", "icon": "gamepad", "color": "#FF6B6B", "playable": False},
    {"id": "puzzle", "name": "Puzzle Games", "icon": "puzzle", "color": "#FF9A9E", "playable": False},
    {"id": "casual", "name": "Casual Games", "icon": "smiley", "color": "#FFB020", "playable": False},
    {"id": "skill", "name": "Skill Games", "icon": "trophy", "color": "#2ECA7F", "playable": False},
    {"id": "tournament", "name": "Tournaments", "icon": "medal", "color": "#E53935", "playable": False},
]


@api.get("/games/catalog")
async def games_catalog():
    return {"categories": GAME_CATEGORIES}


@api.post("/games/play")
async def play_game(payload: PlayGameIn, user=Depends(get_current_user)):
    if payload.bet_amount <= 0:
        raise HTTPException(400, "Bet must be positive")
    if payload.bet_amount > user["balance"]:
        raise HTTPException(400, "Insufficient balance")

    win_rate = await get_win_rate(payload.game_type)
    is_win = random.random() < win_rate

    # deduct bet up-front
    await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": -payload.bet_amount, "total_wagered": payload.bet_amount}})
    await add_transaction(user["id"], "bet", -payload.bet_amount, {"game": payload.game_type})

    payout = 0.0
    result_meta: Dict[str, Any] = {"game": payload.game_type, "win": is_win}

    gt = payload.game_type
    if gt == "crash":
        # multiplier: if win -> user's cash_out point is BELOW crash; else above.
        target = float(payload.params.get("cash_out", 2.0))
        target = max(1.01, min(target, 100.0))
        if is_win:
            crash_at = round(random.uniform(target + 0.1, target + max(5.0, target * 2)), 2)
            payout = payload.bet_amount * target
        else:
            crash_at = round(random.uniform(1.01, max(1.02, target - 0.05)), 2)
        result_meta.update({"crash_at": crash_at, "cash_out": target})
    elif gt == "aviator":
        target = float(payload.params.get("cash_out", 2.0))
        target = max(1.01, min(target, 100.0))
        if is_win:
            fly_to = round(random.uniform(target + 0.2, target + max(6.0, target * 2.5)), 2)
            payout = payload.bet_amount * target
        else:
            fly_to = round(random.uniform(1.01, max(1.02, target - 0.05)), 2)
        result_meta.update({"fly_to": fly_to, "cash_out": target})
    elif gt == "dice":
        # user picks "over" or "under" a threshold 1..99. multiplier ~ 99/chance
        pick = payload.params.get("pick", "over")
        threshold = int(payload.params.get("threshold", 50))
        threshold = max(2, min(98, threshold))
        if pick == "over":
            chance = 100 - threshold
        else:
            chance = threshold
        multiplier = round(97.0 / chance, 2)
        # roll must reflect outcome
        if is_win:
            if pick == "over":
                roll = random.randint(threshold + 1, 100)
            else:
                roll = random.randint(1, threshold - 1)
            payout = payload.bet_amount * multiplier
        else:
            if pick == "over":
                roll = random.randint(1, threshold)
            else:
                roll = random.randint(threshold, 100)
        result_meta.update({"roll": roll, "pick": pick, "threshold": threshold, "multiplier": multiplier})
    elif gt == "spin":
        # 8 segments with different multipliers
        segments = payload.params.get("segments") or [0, 1.5, 0, 2, 0, 3, 0, 5]
        segments = [float(s) for s in segments]
        winning_indices = [i for i, v in enumerate(segments) if v > 0]
        losing_indices = [i for i, v in enumerate(segments) if v <= 0]
        if is_win and winning_indices:
            idx = random.choice(winning_indices)
        else:
            idx = random.choice(losing_indices or list(range(len(segments))))
            is_win = segments[idx] > 0
        if is_win:
            payout = payload.bet_amount * segments[idx]
        result_meta.update({"segment_index": idx, "segment_multiplier": segments[idx]})
    elif gt == "andar-bahar":
            pick = str(payload.params.get("pick", "andar")).lower()

            if pick not in ("andar", "bahar"):
                pick = "andar"

            winner = pick if is_win else (
                "bahar" if pick == "andar" else "andar"
            )

            joker = random_card()

            deck = [
                {"rank": r, "suit": s}
                for r in DECK_RANKS
                for s in DECK_SUITS
                if not (
                    r == joker["rank"]
                    and s == joker["suit"]
                )
            ]

            random.shuffle(deck)

            non_matching = [
                card for card in deck
                if card["rank"] != joker["rank"]
            ]

            random.shuffle(non_matching)

            cards_before_match = 8

            andar_cards = []
            bahar_cards = []

            card_index = 0

            for i in range(cards_before_match):
                card = non_matching[card_index]
                card_index += 1

                if i % 2 == 0:
                    andar_cards.append(card)
                else:
                    bahar_cards.append(card)

            matching_cards = [
                card for card in deck
                if card["rank"] == joker["rank"]
            ]

            matching_card = random.choice(matching_cards)

            if winner == "andar":
                andar_cards.append(matching_card)
            else:
                bahar_cards.append(matching_card)

            if len(andar_cards) == 0:
                andar_cards.append(non_matching[card_index])
                card_index += 1

            if len(bahar_cards) == 0:
                bahar_cards.append(non_matching[card_index])
                card_index += 1

            result_meta["pick"] = pick
            result_meta["winner"] = winner
            result_meta["joker_card"] = joker

            result_meta["andar_cards"] = andar_cards
            result_meta["bahar_cards"] = bahar_cards

            result_meta["andar_card"] = (
                matching_card
                if winner == "andar"
                else None
            )

            result_meta["bahar_card"] = (
                matching_card
                if winner == "bahar"
                else None
            )

            result_meta["match_card"] = matching_card

            print("AB JOKER:", joker)
            print("AB ANDAR:", andar_cards)
            print("AB BAHAR:", bahar_cards)
            print("AB WINNER:", winner)

            if is_win:
                payout = payload.bet_amount * 1.9
                result_meta["multiplier"] = 1.9

            print("🔥🔥 NEW AB CODE RUNNING 🔥🔥")
            print("🔥 ANDAR COUNT:", len(result_meta.get("andar_cards", [])))
            print("🔥 BAHAR COUNT:", len(result_meta.get("bahar_cards", [])))
    
    elif gt == "teenpatti":
        player_cards = dealer_cards = None
        player_hand = dealer_hand = None
        for _ in range(40):
            pc, dc = deal_teenpatti_cards()
            ph, dh = teenpatti_hand_type(pc), teenpatti_hand_type(dc)
            if is_win and TEENPATTI_HAND_SCORE[ph] > TEENPATTI_HAND_SCORE[dh]:
                player_cards, dealer_cards, player_hand, dealer_hand = pc, dc, ph, dh
                break
            if not is_win and TEENPATTI_HAND_SCORE[ph] <= TEENPATTI_HAND_SCORE[dh]:
                player_cards, dealer_cards, player_hand, dealer_hand = pc, dc, ph, dh
                break
        if player_cards is None:
            player_cards, dealer_cards, player_hand, dealer_hand = pc, dc, ph, dh

        result_meta["player_hand"] = player_hand
        result_meta["dealer_hand"] = dealer_hand
        result_meta["player_cards"] = player_cards
        result_meta["dealer_cards"] = dealer_cards
        if is_win:
            payout = payload.bet_amount * 2.0
            result_meta["multiplier"] = 2.0
    elif gt == "number-king":
        pick = int(payload.params.get("number", 5)); pick = max(0, min(9, pick))
        roll = pick if is_win else random.choice([n for n in range(10) if n != pick])
        if is_win: payout = payload.bet_amount * 3.0
        result_meta.update({"pick": pick, "roll": roll, "multiplier": 3.0})
    elif gt == "plinko":
        # Authentic 14-row Plinko: each peg encounter sends the ball left or right.
        # Fourteen independent bounces create 15 possible landing slots with a
        # binomial (center-heavy) landing distribution instead of a uniform slot pick.
        plinko_multipliers = [5, 2, 1.8, 1.5, 1.2, 0.8, 0.5, 0.2, 0.5, 0.8, 1.2, 1.5, 1.8, 2, 5]
        path = [random.choice([-1, 1]) for _ in range(14)]  # -1 = left, +1 = right
        slot = sum(1 for direction in path if direction == 1)
        multiplier = float(plinko_multipliers[slot])

        # Payout comes from the physical landing slot, not a separate random win roll.
        payout = round(float(payload.bet_amount) * multiplier, 2)
        is_win = multiplier > 1.0
        result_meta.update({
            "win": is_win,
            "slot": slot,
            "path": ["R" if direction == 1 else "L" for direction in path],
            "rows": 14,
            "multiplier": multiplier,
            "final_multiplier": multiplier,
            "payout": payout,
        })
    elif gt == "mines":
        picks = int(payload.params.get("picks", 3)); picks = max(1, min(5, picks))
        multiplier = round(1.0 + picks * 0.6, 2)
        if is_win:
            payout = payload.bet_amount * multiplier
            revealed = ["gem"] * picks
        else:
            mine_at = random.randint(0, picks - 1)
            revealed = ["gem" if i != mine_at else "mine" for i in range(picks)]
        result_meta.update({"picks": picks, "revealed": revealed, "multiplier": multiplier})
    elif gt == "match3":
        symbols = ["A", "B", "C", "S", "D", "7"]
        if is_win:
            sym = random.choice(symbols); board = [sym, sym, sym]
            mult = 5.0 if sym in ("D", "7") else 2.5
            payout = payload.bet_amount * mult; result_meta["multiplier"] = mult
        else:
            board = random.sample(symbols, 3)
        result_meta["board"] = board
    elif gt == "bullseye":
        if is_win:
            ring = random.choices(["bullseye", "inner", "middle"], weights=[1, 2, 3])[0]
            mult = {"bullseye": 10.0, "inner": 5.0, "middle": 2.0}[ring]
            payout = payload.bet_amount * mult
            result_meta.update({"ring": ring, "multiplier": mult})
        else:
            result_meta.update({"ring": "miss", "multiplier": 0})
    elif gt == "sudoku":
        if is_win: payout = payload.bet_amount * 2.5; result_meta["multiplier"] = 2.5
    elif gt == "tournament":
        rank = random.randint(1, 3) if is_win else random.randint(4, 10)
        if is_win:
            mult = {1: 8.0, 2: 4.0, 3: 2.0}[rank]
            payout = payload.bet_amount * mult; result_meta["multiplier"] = mult
        result_meta["rank"] = rank
    else:
        # generic
        if is_win:
            multiplier = round(random.uniform(1.5, 3.0), 2)
            payout = payload.bet_amount * multiplier
            result_meta["multiplier"] = multiplier

    if payout > 0:
        await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": payout}})
        await add_transaction(user["id"], "win", payout, result_meta)

    fresh = clean(await db.users.find_one({"id": user["id"]}))
    return {"win": is_win, "payout": payout, "balance": fresh["balance"], "result": result_meta}


# =========================================================
# INTERACTIVE CRASH / AVIATOR (live tap-to-cash-out)
# =========================================================
@api.post("/games/crash/start")
async def crash_start(payload: CrashStartIn, user=Depends(get_current_user)):
    bet = payload.bet_amount
    if bet <= 0:
        raise HTTPException(400, "Bet must be positive")
    if bet > user["balance"]:
        raise HTTPException(400, "Insufficient balance")

    win_rate = await get_win_rate(payload.game_type)
    winnable = random.random() < win_rate
    # Economics: ~win_rate rounds give room to cash out; rest crash almost instantly.
    if winnable:
        crash_point = round(random.uniform(1.30, 12.0), 2)
    else:
        crash_point = round(random.uniform(1.00, 1.25), 2)

    await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": -bet, "total_wagered": bet}})
    await add_transaction(user["id"], "bet", -bet, {"game": payload.game_type})

    rid = new_id()
    started_at = datetime.now(timezone.utc)
    await db.crash_rounds.insert_one({
        "id": rid,
        "user_id": user["id"],
        "game_type": payload.game_type,
        "bet": bet,
        "crash_point": crash_point,
        "auto_cash_out": payload.auto_cash_out,
        "started_at": started_at.isoformat(),
        "settled": False,
    })
    fresh = clean(await db.users.find_one({"id": user["id"]}))
    # crash_point is intentionally NOT returned to the client (anti-cheat).
    return {
        "round_id": rid,
        "started_at": started_at.isoformat(),
        "auto_cash_out": payload.auto_cash_out,
        "balance": fresh["balance"],
        "curve": {"a": CRASH_A, "b": CRASH_B},
    }


@api.post("/games/crash/cashout")
async def crash_cashout(payload: CrashCashoutIn, user=Depends(get_current_user)):
    rnd = await db.crash_rounds.find_one({"id": payload.round_id, "user_id": user["id"]})
    if not rnd:
        raise HTTPException(404, "Round not found")
    if rnd["settled"]:
        raise HTTPException(400, "Round already settled")

    started = datetime.fromisoformat(rnd["started_at"])
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    server_mult = crash_multiplier_at(elapsed)
    crash_point = rnd["crash_point"]

    # If the round has already reached the crash point (server-side time), it's a loss.
    if server_mult >= crash_point:
        await db.crash_rounds.update_one({"id": rnd["id"]}, {"$set": {"settled": True, "outcome": "crashed", "settled_at": now_iso()}})
        fresh = clean(await db.users.find_one({"id": user["id"]}))
        return {"win": False, "crashed": True, "crash_point": crash_point, "balance": fresh["balance"]}

    # Effective cash-out multiplier: clamped by both crash point and server time (anti-cheat).
    effective = min(payload.multiplier, crash_point, server_mult + 0.15)
    effective = max(1.01, round(effective, 2))
    payout = round(rnd["bet"] * effective, 2)

    await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": payout}})
    await add_transaction(user["id"], "win", payout, {"game": rnd["game_type"], "multiplier": effective, "win": True})
    await db.crash_rounds.update_one({"id": rnd["id"]}, {"$set": {"settled": True, "outcome": "cashed", "cash_multiplier": effective, "settled_at": now_iso()}})
    fresh = clean(await db.users.find_one({"id": user["id"]}))
    return {"win": True, "crashed": False, "multiplier": effective, "payout": payout, "balance": fresh["balance"]}


@api.post("/games/crash/settle")
async def crash_settle(payload: CrashSettleIn, user=Depends(get_current_user)):
    """Called by the client when the rocket crashed without a cash-out. Bet already deducted."""
    rnd = await db.crash_rounds.find_one({"id": payload.round_id, "user_id": user["id"]})
    if not rnd:
        raise HTTPException(404, "Round not found")
    if not rnd["settled"]:
        await db.crash_rounds.update_one({"id": rnd["id"]}, {"$set": {"settled": True, "outcome": "crashed", "settled_at": now_iso()}})
    fresh = clean(await db.users.find_one({"id": user["id"]}))
    return {"win": False, "crash_point": rnd["crash_point"], "balance": fresh["balance"]}


@api.get("/games/crash/status/{round_id}")
async def crash_status(round_id: str, user=Depends(get_current_user)):
    """Polled by the client. Reveals crash_point ONLY once the round has actually crashed."""
    rnd = await db.crash_rounds.find_one({"id": round_id, "user_id": user["id"]})
    if not rnd:
        raise HTTPException(404, "Round not found")
    started = datetime.fromisoformat(rnd["started_at"])
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    server_mult = crash_multiplier_at(elapsed)
    crash_point = rnd["crash_point"]
    if rnd["settled"] and rnd.get("outcome") == "cashed":
        return {"status": "cashed", "multiplier": rnd.get("cash_multiplier"), "crash_point": crash_point}
    if server_mult >= crash_point:
        if not rnd["settled"]:
            await db.crash_rounds.update_one({"id": rnd["id"]}, {"$set": {"settled": True, "outcome": "crashed", "settled_at": now_iso()}})
        return {"status": "crashed", "crash_point": crash_point, "multiplier": crash_point}
    return {"status": "flying", "multiplier": server_mult}

@api.get("/games/crash/live-state")
async def crash_live_state():
    """Public — anyone can poll this to see the current global round state."""
    live = await db.crash_live.find_one({"id": "live"}, {"_id": 0})
    if not live:
        return {"status": "waiting", "time_left": LIVE_WAIT_SECONDS, "multiplier": 1.0, "round_total_bet": 0.0, "round_player_count": 0}

    round_id = live["round_id"]
    bets = await db.crash_live_bets.find({"round_id": round_id}, {"_id": 0, "bet": 1}).to_list(10000)
    round_total_bet = round(sum(b["bet"] for b in bets), 2)
    round_player_count = len(bets)

    status = live["status"]
    if status == "waiting":
        wait_ends = datetime.fromisoformat(live["wait_ends_at"])
        time_left = max(0, (wait_ends - datetime.now(timezone.utc)).total_seconds())
        return {"status": "waiting", "time_left": round(time_left, 1), "round_id": round_id, "round_total_bet": round_total_bet, "round_player_count": round_player_count}

    if status == "flying":
        started = datetime.fromisoformat(live["started_at"])
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        mult = crash_multiplier_at(elapsed)
        return {"status": "flying", "multiplier": mult, "round_id": round_id, "round_total_bet": round_total_bet, "round_player_count": round_player_count}

    if status == "crashed":
        return {"status": "crashed", "crash_point": live["crash_point"], "round_id": round_id, "round_total_bet": round_total_bet, "round_player_count": round_player_count}

    return {"status": "waiting", "time_left": LIVE_WAIT_SECONDS, "round_total_bet": 0.0, "round_player_count": 0}

@api.post("/games/crash/live-bet")
async def crash_live_bet(payload: LiveCrashBetIn, user=Depends(get_current_user)):
    live = await db.crash_live.find_one({"id": "live"})
    if not live or live["status"] != "waiting":
        raise HTTPException(400, "Betting is closed. Wait for the next round.")

    bet = payload.bet_amount
    if bet <= 0:
        raise HTTPException(400, "Bet must be positive")
    if bet > user["balance"]:
        raise HTTPException(400, "Insufficient balance")

    existing = await db.crash_live_bets.find_one({"round_id": live["round_id"], "user_id": user["id"]})
    if existing:
        raise HTTPException(400, "You already placed a bet for this round")

    await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": -bet, "total_wagered": bet}})
    await add_transaction(user["id"], "bet", -bet, {"game": "crash-live"})

    await db.crash_live_bets.insert_one({
        "id": new_id(),
        "round_id": live["round_id"],
        "user_id": user["id"],
        "bet": bet,
        "auto_cash_out": payload.auto_cash_out,
        "cashed_out": False,
        "created_at": now_iso(),
    })
    fresh = clean(await db.users.find_one({"id": user["id"]}))
    return {"success": True, "balance": fresh["balance"], "round_id": live["round_id"]}

class LiveCashoutIn(BaseModel):
    round_id: str


@api.post("/games/crash/live-cashout")
async def crash_live_cashout(payload: LiveCashoutIn, user=Depends(get_current_user)):
    live = await db.crash_live.find_one({"id": "live"})
    if not live or live["round_id"] != payload.round_id:
        raise HTTPException(400, "Round no longer active")
    if live["status"] != "flying":
        raise HTTPException(400, "Round is not flying")

    bet_doc = await db.crash_live_bets.find_one({"round_id": payload.round_id, "user_id": user["id"]})
    if not bet_doc:
        raise HTTPException(404, "No bet found for this round")
    if bet_doc["cashed_out"]:
        raise HTTPException(400, "Already cashed out")

    started = datetime.fromisoformat(live["started_at"])
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    server_mult = crash_multiplier_at(elapsed)
    crash_point = live["crash_point"]

    if server_mult >= crash_point:
        await db.crash_live_bets.update_one({"id": bet_doc["id"]}, {"$set": {"cashed_out": True, "outcome": "crashed"}})
        fresh = clean(await db.users.find_one({"id": user["id"]}))
        return {"win": False, "crashed": True, "crash_point": crash_point, "balance": fresh["balance"]}

    effective = min(crash_point, server_mult + 0.05)
    effective = max(1.01, round(effective, 2))
    payout = round(bet_doc["bet"] * effective, 2)

    await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": payout}})
    await add_transaction(user["id"], "win", payout, {"game": "crash-live", "multiplier": effective})
    await db.crash_live_bets.update_one({"id": bet_doc["id"]}, {"$set": {"cashed_out": True, "outcome": "cashed", "cash_multiplier": effective}})
    fresh = clean(await db.users.find_one({"id": user["id"]}))
    return {"win": True, "crashed": False, "multiplier": effective, "payout": payout, "balance": fresh["balance"]}

class DtLiveBetIn(BaseModel):
    bet_amount: float
    pick: str  # dragon | tiger


@api.get("/games/dragon-tiger/live-state")
async def dt_live_state():
    """Public — anyone can poll this to see the current global Dragon Tiger round."""
    live = await db.dt_live.find_one({"id": "live"}, {"_id": 0})
    if not live:
        return {"status": "waiting", "time_left": DT_WAIT_SECONDS, "round_total_bet": 0.0, "round_player_count": 0}

    round_id = live["round_id"]
    bets = await db.dt_live_bets.find({"round_id": round_id}, {"_id": 0, "bet": 1}).to_list(10000)
    round_total_bet = round(sum(b["bet"] for b in bets), 2)
    round_player_count = len(bets)

    status = live["status"]
    if status == "waiting":
        wait_ends = datetime.fromisoformat(live["wait_ends_at"])
        time_left = max(0, (wait_ends - datetime.now(timezone.utc)).total_seconds())
        return {"status": "waiting", "time_left": round(time_left, 1), "round_id": round_id, "round_total_bet": round_total_bet, "round_player_count": round_player_count}

    if status == "revealed":
        return {
            "status": "revealed",
            "round_id": round_id,
            "dragon_card": live.get("dragon_card"),
            "tiger_card": live.get("tiger_card"),
            "winner": live.get("winner"),
            "round_total_bet": round_total_bet,
            "round_player_count": round_player_count,
        }

    return {"status": "waiting", "time_left": DT_WAIT_SECONDS, "round_total_bet": 0.0, "round_player_count": 0}


@api.post("/games/dragon-tiger/live-bet")
async def dt_live_bet(payload: DtLiveBetIn, user=Depends(get_current_user)):
    live = await db.dt_live.find_one({"id": "live"})
    if not live or live["status"] != "waiting":
        raise HTTPException(400, "Betting is closed. Wait for the next round.")
    if payload.pick not in ("dragon", "tiger"):
        raise HTTPException(400, "Pick must be dragon or tiger")

    bet = payload.bet_amount
    if bet <= 0:
        raise HTTPException(400, "Bet must be positive")
    if bet > user["balance"]:
        raise HTTPException(400, "Insufficient balance")

    existing = await db.dt_live_bets.find_one({"round_id": live["round_id"], "user_id": user["id"]})
    if existing:
        raise HTTPException(400, "You already placed a bet for this round")

    await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": -bet, "total_wagered": bet}})
    await add_transaction(user["id"], "bet", -bet, {"game": "dragon-tiger"})

    await db.dt_live_bets.insert_one({
        "id": new_id(),
        "round_id": live["round_id"],
        "user_id": user["id"],
        "bet": bet,
        "pick": payload.pick,
        "settled": False,
        "created_at": now_iso(),
    })
    fresh = clean(await db.users.find_one({"id": user["id"]}))
    return {"success": True, "balance": fresh["balance"], "round_id": live["round_id"]}            

# =========================================================
# LIVE BET FEED (recent wins across players)
# =========================================================
_FEED_NAMES = [
    "RajaKing", "LuckyStar", "AceHunter", "NoorX", "ProGamer99", "Mr_Vijay", "SkyWinner",
    "GoldRush", "RoyalAK", "ShadowFox", "BetMaster", "TigerZ", "CrazyRider", "DiamondD",
    "SonuBhai", "QueenBee", "FastCash", "RockyB", "MegaWin", "SilentK", "ThunderX", "ZaraPlays",
]


def _mask_name(name: str) -> str:
    if len(name) <= 3:
        return name[0] + "**"
    return name[:2] + "***" + name[-1]


@api.get("/games/feed")
async def games_feed(game: Optional[str] = None, limit: int = 15):
    """Recent real wins (masked) padded with lively synthetic entries."""
    entries: List[dict] = []
    q: dict = {"kind": "win"}
    async for t in db.transactions.find(q, {"_id": 0}).sort("created_at", -1).limit(limit):
        u = await db.users.find_one({"id": t["user_id"]}, {"name": 1})
        nm = _mask_name((u or {}).get("name", "Player"))
        mult = (t.get("meta") or {}).get("multiplier")
        entries.append({
            "name": nm,
            "game": (t.get("meta") or {}).get("game", "crash"),
            "amount": round(t.get("amount", 0), 2),
            "multiplier": mult,
            "real": True,
        })
    # pad with synthetic
    while len(entries) < limit:
        entries.append({
            "name": _mask_name(random.choice(_FEED_NAMES)),
            "game": game or random.choice(["crash", "aviator", "dice", "spin", "mines", "plinko"]),
            "amount": round(random.choice([50, 120, 250, 480, 999, 1500, 3200, 7800]) * random.uniform(0.5, 1.5), 2),
            "multiplier": round(random.uniform(1.5, 12.0), 2),
            "real": False,
        })
    random.shuffle(entries)
    return {"feed": entries}


# =========================================================
# WIN GO — color prediction (Daman-style timed rounds)
# =========================================================
WINGO_LOCK_SECONDS = 5  # betting closes in the last N seconds


async def _wingo_settle_user(user_id: str, duration: int, current_idx: int):
    """Settle any of the user's unsettled bets for ended periods, generating a 38%-biased result."""
    win_rate = await get_win_rate()
    # group unsettled bets by period
    pending = await db.wingo_bets.find({"user_id": user_id, "duration": duration, "settled": False, "period": {"$lt": current_idx}}, {"_id": 0}).to_list(500)
    by_period: Dict[int, List[dict]] = {}
    for b in pending:
        by_period.setdefault(b["period"], []).append(b)

    for period_idx, bets in by_period.items():
        existing = await db.wingo_results.find_one({"duration": duration, "period": period_idx})
        if existing:
            result_n = existing["number"]
        else:
            # bias result by the user's highest-stake bet
            main = max(bets, key=lambda x: x["amount"])
            winnable = [n for n in range(10) if wingo_bet_wins(main["bet_type"], main["value"], n)]
            losing = [n for n in range(10) if not wingo_bet_wins(main["bet_type"], main["value"], n)]
            is_win = random.random() < win_rate
            if is_win and winnable:
                result_n = random.choice(winnable)
            elif losing:
                result_n = random.choice(losing)
            else:
                result_n = random.choice(winnable) if winnable else random.randint(0, 9)
            await db.wingo_results.insert_one({"duration": duration, "period": period_idx, "number": result_n, "created_at": now_iso()})

        # settle each bet honestly against the result
        for b in bets:
            win = wingo_bet_wins(b["bet_type"], b["value"], result_n)
            payout = round(b["amount"] * wingo_multiplier(b["bet_type"], b["value"], result_n), 2) if win else 0.0
            await db.wingo_bets.update_one({"id": b["id"]}, {"$set": {"settled": True, "win": win, "payout": payout, "result_number": result_n}})
            if payout > 0:
                await db.users.update_one({"id": user_id}, {"$inc": {"balance": payout}})
                await add_transaction(user_id, "win", payout, {"game": "wingo", "period": period_idx, "value": b["value"], "result": result_n})


@api.get("/wingo/state")
async def wingo_state(duration: int = 60, user=Depends(get_current_user)):
    if duration not in (30, 60, 180, 300):
        duration = 60
    current_idx, time_left, display = wingo_period_info(duration)

    # settle user's ended bets first
    await _wingo_settle_user(user["id"], duration, current_idx)

    # current period's total bet (all players)
    current_bets = await db.wingo_bets.find({"duration": duration, "period": current_idx}, {"_id": 0, "amount": 1}).to_list(10000)
    round_total_bet = round(sum(b["amount"] for b in current_bets), 2)
    round_player_count = len(current_bets)

    # build history (last 10 ended periods)
    history = []
    for i in range(1, 11):
        pidx = current_idx - i
        n = await wingo_ensure_result(duration, pidx)
        pstart = pidx * duration
        pdt = datetime.fromtimestamp(pstart, tz=timezone.utc)
        history.append({
            "period": f"{pdt:%Y%m%d}{(pidx % 10000):04d}",
            "number": n,
            "colors": wingo_color_of(n),
            "size": wingo_size_of(n),
        })

    # user's recent bets
    my_bets = await db.wingo_bets.find({"user_id": user["id"], "duration": duration}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    for b in my_bets:
        pstart = b["period"] * duration
        pdt = datetime.fromtimestamp(pstart, tz=timezone.utc)
        b["period_display"] = f"{pdt:%Y%m%d}{(b['period'] % 10000):04d}"

    fresh = clean(await db.users.find_one({"id": user["id"]}))
    return {
        "duration": duration,
        "period": display,
        "period_idx": current_idx,
        "time_left": time_left,
        "locked": time_left <= WINGO_LOCK_SECONDS,
        "history": history,
        "my_bets": my_bets,
        "balance": fresh["balance"],
        "round_total_bet": round_total_bet,
        "round_player_count": round_player_count,
    }


@api.post("/wingo/bet")
async def wingo_bet(payload: WinGoBetIn, user=Depends(get_current_user)):
    duration = payload.duration if payload.duration in (30, 60, 180, 300) else 60
    current_idx, time_left, display = wingo_period_info(duration)
    if time_left <= WINGO_LOCK_SECONDS:
        raise HTTPException(400, "Betting is closed for this round")
    if payload.amount <= 0:
        raise HTTPException(400, "Bet must be positive")
    if payload.amount > user["balance"]:
        raise HTTPException(400, "Insufficient balance")
    # validate value
    if payload.bet_type == "color" and payload.value not in ("green", "violet", "red"):
        raise HTTPException(400, "Invalid color")
    if payload.bet_type == "size" and payload.value not in ("big", "small"):
        raise HTTPException(400, "Invalid size")
    if payload.bet_type == "number" and payload.value not in [str(x) for x in range(10)]:
        raise HTTPException(400, "Invalid number")

    await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": -payload.amount, "total_wagered": payload.amount}})
    await add_transaction(user["id"], "bet", -payload.amount, {"game": "wingo", "period": current_idx, "type": payload.bet_type, "value": payload.value})
    bet = {
        "id": new_id(),
        "user_id": user["id"],
        "duration": duration,
        "period": current_idx,
        "bet_type": payload.bet_type,
        "value": payload.value,
        "amount": payload.amount,
        "settled": False,
        "win": None,
        "payout": 0.0,
        "created_at": now_iso(),
    }
    await db.wingo_bets.insert_one(bet.copy())
    bet.pop("_id", None)
    fresh = clean(await db.users.find_one({"id": user["id"]}))
    return {"success": True, "bet": bet, "balance": fresh["balance"], "period": display, "time_left": time_left}



# =========================================================
@api.get("/promotions")
async def promotions():
    return await db.promotions.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(50)


@api.get("/vip")
async def vip(user=Depends(get_current_user)):
    tiers = await db.vip_tiers.find({}, {"_id": 0}).sort("min_wager", 1).to_list(20)
    return {"tiers": tiers, "current": user["vip_tier"], "total_wagered": user.get("total_wagered", 0.0)}


@api.get("/notifications")
async def get_notifications(user=Depends(get_current_user)):
    return await db.notifications.find({"$or": [{"user_id": user["id"]}, {"broadcast": True}]}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api.post("/notifications/{nid}/read")
async def mark_read(nid: str, user=Depends(get_current_user)):
    await db.notifications.update_one({"id": nid}, {"$set": {"read": True}})
    return {"success": True}


@api.post("/support/tickets")
async def create_ticket(payload: SupportTicketIn, user=Depends(get_current_user)):
    t = {
        "id": new_id(),
        "user_id": user["id"],
        "user_phone": user["phone"],
        "subject": payload.subject,
        "message": payload.message,
        "status": "open",
        "created_at": now_iso(),
    }
    await db.tickets.insert_one(t.copy())
    t.pop("_id", None)
    return t


@api.get("/support/tickets")
async def my_tickets(user=Depends(get_current_user)):
    return await db.tickets.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)


# =========================================================
# ADMIN
# =========================================================
@api.post("/admin/login")
async def admin_login(payload: AdminLoginIn):
    admin = await db.admins.find_one({"phone": payload.phone})
    if not admin or not verify_password(payload.password, admin["password_hash"]):
        raise HTTPException(401, "Invalid phone or password")
    return {"token": create_token(admin["id"], "admin"), "admin": {"id": admin["id"], "phone": admin["phone"], "name": admin["name"]}}


@api.get("/admin/dashboard")
async def admin_dashboard(admin=Depends(get_current_admin)):
    total_users = await db.users.count_documents({})
    pending_deposits = await db.deposits.count_documents({"status": "pending"})
    pending_withdrawals = await db.withdrawals.count_documents({"status": "pending"})
    # daily revenue = sum of approved deposits today
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    deposits_today = await db.deposits.find({"status": "approved", "created_at": {"$gte": today_start}}, {"_id": 0}).to_list(1000)
    revenue_today = sum(d["amount"] for d in deposits_today)
    total_deposits_amt = 0.0
    async for d in db.deposits.find({"status": "approved"}, {"amount": 1}):
        total_deposits_amt += d.get("amount", 0)
    total_withdrawals_amt = 0.0
    async for w in db.withdrawals.find({"status": "approved"}, {"amount": 1}):
        total_withdrawals_amt += w.get("amount", 0)
    return {
        "total_users": total_users,
        "pending_deposits": pending_deposits,
        "pending_withdrawals": pending_withdrawals,
        "revenue_today": revenue_today,
        "total_deposits": total_deposits_amt,
        "total_withdrawals": total_withdrawals_amt,
    }


@api.get("/admin/users")
async def admin_list_users(admin=Depends(get_current_admin), q: Optional[str] = None):
    query: dict = {}
    if q:
        query = {"$or": [{"phone": {"$regex": q, "$options": "i"}}, {"uid": {"$regex": q, "$options": "i"}}, {"name": {"$regex": q, "$options": "i"}}]}
    return await db.users.find(query, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)


@api.post("/admin/users/{uid}/adjust")
async def admin_adjust_balance(uid: str, payload: Dict[str, Any], admin=Depends(get_current_admin)):
    # Admin-only manual wallet adjustment. Accept either the internal id or the
    # public UID shown in the admin/user screens.
    try:
        delta = float(payload.get("delta", 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "Coins amount must be a valid number")
    if not math.isfinite(delta) or delta == 0:
        raise HTTPException(400, "Coins amount must be greater than zero")
    if abs(delta) > 100000000:
        raise HTTPException(400, "Coins amount is too large")

    reason = str(payload.get("reason", "Admin adjustment")).strip()[:160] or "Admin adjustment"
    user = await db.users.find_one({"id": uid})
    if not user:
        user = await db.users.find_one({"uid": uid})
    if not user:
        raise HTTPException(404, "User not found")

    user_id = user.get("id")
    if not user_id:
        raise HTTPException(400, "User record is missing its internal ID")

    # Prevent a negative wallet when an admin performs a debit adjustment.
    if delta < 0:
        current_balance = float(user.get("balance", 0) or 0)
        if current_balance + delta < 0:
            raise HTTPException(400, "Insufficient balance for this adjustment")

    await db.users.update_one({"id": user_id}, {"$inc": {"balance": delta}})
    await add_transaction(user_id, "bonus" if delta > 0 else "refund", delta,
                          {"reason": reason, "by": admin.get("phone", "admin")})
    if delta > 0:
        await db.notifications.insert_one({
            "id": new_id(), "user_id": user_id,
            "title": "Coins Added by Admin",
            "body": f"{delta:g} coins were added to your wallet. Reason: {reason}",
            "read": False, "created_at": now_iso(),
        })
    return clean(await db.users.find_one({"id": user_id}))


@api.post("/admin/users/{uid}/block")
async def admin_block_user(uid: str, admin=Depends(get_current_admin)):
    u = await db.users.find_one({"id": uid})
    if not u:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"id": uid}, {"$set": {"blocked": not u.get("blocked", False)}})
    return clean(await db.users.find_one({"id": uid}))


@api.get("/admin/deposits")
async def admin_list_deposits(admin=Depends(get_current_admin), status: Optional[str] = None):
    q: dict = {}
    if status:
        q["status"] = status
    return await db.deposits.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.post("/admin/deposits/{did}/{action}")
async def admin_act_deposit(did: str, action: str, admin=Depends(get_current_admin)):
    if action not in {"approve", "reject"}:
        raise HTTPException(400, "action must be approve|reject")
    dep = await db.deposits.find_one({"id": did})
    if not dep:
        raise HTTPException(404, "Not found")
    if dep["status"] != "pending":
        raise HTTPException(400, "Already processed")
    if action == "approve":
        await db.users.update_one({"id": dep["user_id"]}, {"$inc": {"balance": dep["amount"]}})
        await add_transaction(dep["user_id"], "deposit", dep["amount"], {"utr": dep["utr"], "method": dep["method"]})
        await db.notifications.insert_one({
            "id": new_id(), "user_id": dep["user_id"],
            "title": "Deposit Approved",
            "body": f"₹{dep['amount']} credited to your wallet.", "read": False, "created_at": now_iso(),
        })
    else:
        await db.notifications.insert_one({
            "id": new_id(), "user_id": dep["user_id"],
            "title": "Deposit Rejected",
            "body": f"Your deposit of ₹{dep['amount']} was rejected. Please contact support.", "read": False, "created_at": now_iso(),
        })
    await db.deposits.update_one({"id": did}, {"$set": {"status": "approved" if action == "approve" else "rejected", "processed_at": now_iso(), "processed_by": admin["phone"]}})
    return clean(await db.deposits.find_one({"id": did}))


@api.get("/admin/withdrawals")
async def admin_list_withdrawals(admin=Depends(get_current_admin), status: Optional[str] = None):
    q: dict = {}
    if status:
        q["status"] = status
    return await db.withdrawals.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.post("/admin/withdrawals/{wid}/{action}")
async def admin_act_withdrawal(wid: str, action: str, admin=Depends(get_current_admin)):
    if action not in {"approve", "reject"}:
        raise HTTPException(400, "action must be approve|reject")
    w = await db.withdrawals.find_one({"id": wid})
    if not w:
        raise HTTPException(404, "Not found")
    if w["status"] != "pending":
        raise HTTPException(400, "Already processed")
    if action == "approve":
        # funds already locked; complete the tx
        payout_destination = w.get("upi_id") if w.get("method", "upi") == "upi" else f"bank account ending {str(w.get('account_number', ''))[-4:]}"
        await add_transaction(w["user_id"], "withdraw", -w["amount"], {"method": w.get("method", "upi"), "status": "completed", "destination": payout_destination}, status="completed")
        await db.notifications.insert_one({
            "id": new_id(), "user_id": w["user_id"],
            "title": "Withdrawal Approved",
            "body": f"Your withdrawal request of ₹{w['amount']} was approved. Please check the payout destination for transfer status.", "read": False, "created_at": now_iso(),
        })
    else:
        # refund
        await db.users.update_one({"id": w["user_id"]}, {"$inc": {"balance": w["amount"]}})
        await add_transaction(w["user_id"], "refund", w["amount"], {"reason": "Withdrawal rejected"})
        await db.notifications.insert_one({
            "id": new_id(), "user_id": w["user_id"],
            "title": "Withdrawal Rejected",
            "body": f"Your withdrawal of ₹{w['amount']} was rejected. Amount refunded.", "read": False, "created_at": now_iso(),
        })
    await db.withdrawals.update_one({"id": wid}, {"$set": {"status": "approved" if action == "approve" else "rejected", "processed_at": now_iso(), "processed_by": admin["phone"]}})
    return clean(await db.withdrawals.find_one({"id": wid}))


@api.get("/admin/payment-config")
async def admin_get_payment(admin=Depends(get_current_admin)):
    cfg = clean(await db.payment_config.find_one({"id": "default"})) or {}
    return cfg


@api.patch("/admin/payment-config")
async def admin_update_payment(payload: UpsertPaymentConfigIn, admin=Depends(get_current_admin)):
    doc = payload.model_dump(exclude_none=True)
    doc["updated_at"] = now_iso()
    await db.payment_config.update_one({"id": "default"}, {"$set": doc}, upsert=True)
    return clean(await db.payment_config.find_one({"id": "default"}))


@api.patch("/admin/app-settings")
async def admin_update_app_settings(payload: Dict[str, Any], admin=Depends(get_current_admin)):
    # allow tweaking global win rate
    if "player_win_rate" in payload:
        wr = float(payload["player_win_rate"])
        wr = max(0.0, min(1.0, wr))
        await db.payment_config.update_one({"id": "default"}, {"$set": {"player_win_rate": wr}}, upsert=True)
    # allow tweaking per-game win rate: { "game_win_rates": { "crash": 0.3, "dice": 0.4 } }
    if "game_win_rates" in payload:
        rates = payload["game_win_rates"]
        if isinstance(rates, dict):
            cfg = await db.payment_config.find_one({"id": "default"}) or {}
            existing = cfg.get("game_win_rates", {})
            for k, v in rates.items():
                existing[k] = max(0.0, min(1.0, float(v)))
            await db.payment_config.update_one({"id": "default"}, {"$set": {"game_win_rates": existing}}, upsert=True)
    return clean(await db.payment_config.find_one({"id": "default"}))


@api.post("/admin/broadcast")
async def admin_broadcast(payload: BroadcastIn, admin=Depends(get_current_admin)):
    doc = {
        "id": new_id(),
        "title": payload.title,
        "body": payload.body,
        "broadcast": True,
        "read": False,
        "created_at": now_iso(),
    }
    await db.notifications.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


@api.get("/admin/reports")
async def admin_reports(admin=Depends(get_current_admin)):
    # basic aggregate for last 7 days
    from collections import defaultdict
    days_data: Dict[str, Dict[str, float]] = defaultdict(lambda: {"deposits": 0.0, "withdrawals": 0.0, "bets": 0.0, "wins": 0.0})
    async for d in db.deposits.find({"status": "approved"}, {"_id": 0}):
        days_data[d["created_at"][:10]]["deposits"] += d["amount"]
    async for w in db.withdrawals.find({"status": "approved"}, {"_id": 0}):
        days_data[w["created_at"][:10]]["withdrawals"] += w["amount"]
    async for t in db.transactions.find({"kind": "bet"}, {"_id": 0}):
        days_data[t["created_at"][:10]]["bets"] += abs(t["amount"])
    async for t in db.transactions.find({"kind": "win"}, {"_id": 0}):
        days_data[t["created_at"][:10]]["wins"] += t["amount"]
    series = sorted([{"date": k, **v} for k, v in days_data.items()], key=lambda x: x["date"])
    return {"series": series[-14:]}


@api.get("/admin/game-stats")
async def admin_game_stats(admin=Depends(get_current_admin)):
    """Aggregate bets/wins per game type — helps decide win rate."""
    from collections import defaultdict
    stats: Dict[str, Dict[str, float]] = defaultdict(lambda: {"total_bet": 0.0, "total_win": 0.0, "bet_count": 0, "win_count": 0})

    async for t in db.transactions.find({"kind": "bet"}, {"_id": 0}):
        game = (t.get("meta") or {}).get("game", "unknown")
        stats[game]["total_bet"] += abs(t.get("amount", 0))
        stats[game]["bet_count"] += 1

    async for t in db.transactions.find({"kind": "win"}, {"_id": 0}):
        game = (t.get("meta") or {}).get("game", "unknown")
        stats[game]["total_win"] += t.get("amount", 0)
        stats[game]["win_count"] += 1

    result = []
    for game, s in stats.items():
        net = s["total_bet"] - s["total_win"]
        result.append({
            "game": game,
            "total_bet": round(s["total_bet"], 2),
            "total_win": round(s["total_win"], 2),
            "net_profit": round(net, 2),
            "bet_count": s["bet_count"],
            "win_count": s["win_count"],
            "actual_win_rate": round(s["win_count"] / s["bet_count"], 3) if s["bet_count"] > 0 else 0,
        })
    result.sort(key=lambda x: -x["total_bet"])
    return {"stats": result}


@api.get("/admin/tickets")
async def admin_tickets(admin=Depends(get_current_admin)):
    return await db.tickets.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)



# Fantasy Cricket backend routes (inserted before the Root section)
import json as _json
from urllib.parse import urlencode as _urlencode
from urllib.request import Request as _UrlRequest, urlopen as _urlopen
from urllib.error import HTTPError as _HTTPError, URLError as _URLError

CRICKET_API_KEY = os.environ.get("CRICKET_API_KEY", "").strip()
CRICKET_API_BASE = os.environ.get("CRICKET_API_BASE", "https://cricketliveapi.com/api/v1").rstrip("/")
FANTASY_STARTING_COINS = 0  # Fantasy uses the existing main wallet; no separate starter balance.

class FantasyTeamCreateIn(BaseModel):
    match_id: str
    team_name: str = Field(default="My Fantasy Team", min_length=1, max_length=40)
    player_ids: List[str] = Field(min_length=11, max_length=11)
    captain_id: str
    vice_captain_id: str

class FantasyJoinContestIn(BaseModel):
    team_id: str


def _sportmonks_request_sync(path: str, params: Optional[dict] = None) -> dict:
    """Call CricketLiveAPI using its documented Bearer-token authentication."""
    if not CRICKET_API_KEY:
        raise HTTPException(503, "Cricket API key is not configured. Add CRICKET_API_KEY to backend .env.")
    query = _urlencode(params or {}, doseq=True)
    url = f"{CRICKET_API_BASE}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{query}"
    request = _UrlRequest(url, headers={
        "Authorization": f"Bearer {CRICKET_API_KEY}",
        "Accept": "application/json",
        "User-Agent": "Villain11-Fantasy/1.0",
    })
    try:
        with _urlopen(request, timeout=15) as response:
            body = _json.loads(response.read().decode("utf-8"))
        if isinstance(body, dict) and str(body.get("status", "success")).lower() == "error":
            message = str(body.get("message") or "Cricket data provider returned an error.")
            if "match not found" in message.lower():
                raise HTTPException(404, message)
            logger.warning("CricketLiveAPI error for %s: %s", path, message)
            raise HTTPException(502, message)
        return body
    except _HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        if exc.code in (401, 403):
            raise HTTPException(502, "CricketLiveAPI rejected the API token or this plan does not include the endpoint.")
        if exc.code == 429:
            raise HTTPException(503, "CricketLiveAPI quota/rate limit reached. Try again shortly.")
        if exc.code == 404:
            logger.warning("CricketLiveAPI 404 for %s: %s", path, detail[:300])
            raise HTTPException(404, "Cricket data not published for this endpoint or match yet.")
        logger.warning("CricketLiveAPI HTTP error %s for %s: %s", exc.code, path, detail[:300])
        raise HTTPException(502, "CricketLiveAPI request failed.")
    except HTTPException:
        raise
    except (TimeoutError, _URLError) as exc:
        logger.warning("CricketLiveAPI connection error: %s", exc)
        raise HTTPException(502, "Could not connect to CricketLiveAPI.")
    except Exception as exc:
        logger.warning("CricketLiveAPI response error: %s", exc)
        raise HTTPException(502, "Invalid response from CricketLiveAPI.")

async def _sportmonks_get(path: str, params: Optional[dict] = None) -> dict:
    return await asyncio.to_thread(_sportmonks_request_sync, path, params)

def _sm_data(response: dict):
    """Unwrap CricketLiveAPI's {status, data: ...} response envelope."""
    if not isinstance(response, dict):
        return []
    data = response.get("data", response)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("matches", "players", "playing_xi", "points"):
            if isinstance(data.get(key), list):
                return data[key]
        # Some detail endpoints return a single object in data.
        if data.get("match_id") is not None or data.get("id") is not None:
            return data
    return []

def _sm_team_name(team: Any, fallback: str = "TBD") -> str:
    if isinstance(team, dict):
        return str(team.get("name") or team.get("fullname") or team.get("code") or fallback)
    if isinstance(team, str) and team.strip():
        return team.strip()
    return fallback

def _normalize_fantasy_match(match: dict) -> dict:
    # CricketLiveAPI returns compact fields such as match_id, teams, format, score.
    teams = str(match.get("teams") or match.get("name") or "").split(" vs ", 1)
    local = match.get("localteam") or match.get("local_team") or {}
    visitor = match.get("visitorteam") or match.get("visitor_team") or {}
    team_a_name = _sm_team_name(local, teams[0] if teams else "Team A")
    team_b_name = _sm_team_name(visitor, teams[1] if len(teams) > 1 else "Team B")
    raw_status = match.get("status") or match.get("match_status") or "Scheduled"
    if isinstance(raw_status, dict):
        raw_status = raw_status.get("name") or raw_status.get("short") or raw_status.get("description") or "Scheduled"
    status_text = str(raw_status)
    mid = match.get("match_id") or match.get("id")
    live = bool(match.get("live")) or any(x in status_text.lower() for x in ("live", "innings", "in play"))
    scores = []
    if match.get("score"):
        scores.append({"score": match.get("score"), "overs": match.get("overs"), "wickets": match.get("wickets")})
    return {
        "id": str(mid) if mid is not None else "", "provider_id": mid,
        "league_id": match.get("league_id"), "season_id": match.get("season_id"),
        "name": match.get("name") or match.get("teams") or f"{team_a_name} vs {team_b_name}",
        "format": match.get("format") or match.get("type") or "Cricket",
        "status": status_text, "live": live,
        "starting_at": match.get("starting_at") or match.get("start_time") or match.get("date"),
        "venue": match.get("venue"),
        "team_a": {"id": match.get("team1_id") or (local.get("id") if isinstance(local, dict) else None), "name": team_a_name, "code": match.get("team1_code") or (local.get("code") if isinstance(local, dict) else None), "logo": local.get("image_path") if isinstance(local, dict) else None},
        "team_b": {"id": match.get("team2_id") or (visitor.get("id") if isinstance(visitor, dict) else None), "name": team_b_name, "code": match.get("team2_code") or (visitor.get("code") if isinstance(visitor, dict) else None), "logo": visitor.get("image_path") if isinstance(visitor, dict) else None},
        "scores": scores, "score": match.get("score"), "note": match.get("note"),
    }

def _normalize_fantasy_player(player: dict) -> dict:
    pid = player.get("player_id") or player.get("id")
    name = player.get("name") or player.get("fullname") or " ".join(str(player.get(k) or "") for k in ("firstname", "lastname")).strip()
    role = str(player.get("role") or player.get("position") or "BAT").upper()
    if role not in {"WK", "BAT", "AR", "BOWL"}:
        role_text = role.lower().replace("-", " ")
        role = "WK" if "keeper" in role_text or "wicket" in role_text else "AR" if "all round" in role_text or "allround" in role_text else "BOWL" if "bowl" in role_text else "BAT"
    team = player.get("team")
    team_id = player.get("team_id")
    if team_id is None and isinstance(team, dict):
        team_id = team.get("id")
    return {"id": str(pid), "name": name or f"Player {pid}", "role": role, "team_id": team_id if team_id is not None else team,
            "credits": float(player.get("credits", {"WK": 8.5, "BAT": 9.0, "AR": 9.5, "BOWL": 8.5}[role]) or 0),
            "photo": player.get("image_path") or player.get("image_url") or player.get("photo"),
            "captain": bool(player.get("captain")), "wicketkeeper": role == "WK",
            "points": float(player.get("fantasy_points", player.get("points", 0)) or 0),
            "is_playing": player.get("is_playing", player.get("playing", None))}

async def _get_fantasy_fixture_players(match_id: str) -> tuple[dict, list]:
    # Match IDs must originate from /fantasy/matches; do not query Sportmonks fixtures.
    matches_resp = await _sportmonks_get("fantasy/matches")
    matches_data = _sm_data(matches_resp)
    if isinstance(matches_data, dict):
        matches_data = [matches_data]
    found = next((m for m in matches_data if isinstance(m, dict) and str(m.get("match_id") or m.get("id")) == str(match_id)), None)
    if not found:
        raise HTTPException(404, "Match ID was not found in CricketLiveAPI fantasy matches. Refresh the match list and select a listed match.")
    player_resp = await _sportmonks_get(f"fantasy/players/{_urlencode({'id': str(match_id)})[3:]}")
    players_data = _sm_data(player_resp)
    if isinstance(players_data, dict):
        players_data = players_data.get("players", []) if isinstance(players_data.get("players"), list) else []
    players = [_normalize_fantasy_player(p) for p in players_data if isinstance(p, dict) and (p.get("player_id") is not None or p.get("id") is not None)]
    # Prefer the confirmed XI endpoint when available, but keep the full fantasy squad if not published.
    try:
        xi_resp = await _sportmonks_get(f"fantasy/playing-xi/{match_id}")
        xi_data = _sm_data(xi_resp)
        if isinstance(xi_data, dict):
            xi_data = xi_data.get("players", []) if isinstance(xi_data.get("players"), list) else []
        xi_ids = {str(p.get("player_id") or p.get("id")) for p in xi_data if isinstance(p, dict)}
        if xi_ids:
            for p in players:
                p["is_playing"] = p["id"] in xi_ids
    except HTTPException as exc:
        logger.info("Playing XI not available yet for match %s: %s", match_id, exc.detail)
    return found, players

async def _fantasy_wallet(user_id: str) -> dict:
    """Fantasy balance is the user's existing main wallet balance, not a separate wallet."""
    wallet = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "balance": 1})
    if not wallet:
        raise HTTPException(404, "User wallet not found")
    return {"user_id": user_id, "balance": float(wallet.get("balance", 0) or 0)}

async def _fantasy_coin_tx(user_id: str, amount: int, kind: str, meta: dict):
    # Keep fantasy activity visible in the existing wallet transaction history.
    tx_kind = "bet" if amount < 0 else ("win" if kind == "contest_prize" else "refund")
    await add_transaction(user_id, tx_kind, float(amount), {"game": "fantasy_cricket", "fantasy_kind": kind, **meta})

def _fantasy_player_role(player: dict) -> str:
    pos = player.get("position")
    if isinstance(pos, dict): pos = pos.get("name") or pos.get("code") or ""
    label = str(pos or player.get("role") or "").lower().replace("-", " ")
    if "keeper" in label or "wicket" in label: return "WK"
    if "all round" in label or "allround" in label: return "AR"
    if "bowl" in label: return "BOWL"
    return "BAT"

@api.get("/fantasy/wallet")
async def fantasy_wallet(user=Depends(get_current_user)):
    wallet = await _fantasy_wallet(user["id"])
    return {"balance": wallet["balance"], "withdrawable": True, "currency": "MAIN_WALLET_COINS", "source": "users.balance"}

@api.get("/fantasy/transactions")
async def fantasy_transactions(user=Depends(get_current_user), limit: int = 50):
    limit = max(1, min(limit, 100))
    return await db.transactions.find({"user_id": user["id"], "meta.game": "fantasy_cricket"}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)

@api.get("/fantasy/matches")
async def fantasy_matches(status: str = "all", days: int = 7, user=Depends(get_current_user)):
    """Return only matches published by CricketLiveAPI's fantasy endpoint."""
    status = status.lower()
    if status not in {"all", "live", "upcoming", "completed"}:
        raise HTTPException(400, "status must be all, live, upcoming, or completed")
    days = max(1, min(days, 14))
    resp = await _sportmonks_get("fantasy/matches")
    raw = _sm_data(resp)
    if isinstance(raw, dict):
        raw = raw.get("matches", []) if isinstance(raw.get("matches"), list) else [raw]
    matches = [_normalize_fantasy_match(m) for m in raw if isinstance(m, dict)]
    now = datetime.now(timezone.utc)
    filtered = []
    for m in matches:
        st = str(m.get("status") or "").lower()
        live = bool(m.get("live"))
        done = _status_is_finished(st)
        if status == "live" and not live: continue
        if status == "upcoming" and (live or done): continue
        if status == "completed" and not done: continue
        # Filter date windows only when provider supplied a parseable date.
        raw_date = m.get("starting_at")
        if raw_date:
            try:
                dt = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
                if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
                if status == "completed" and dt < now - timedelta(days=days): continue
                if status != "completed" and dt > now + timedelta(days=days): continue
            except (ValueError, TypeError):
                pass
        if m.get("id"):
            filtered.append(m)
    filtered.sort(key=lambda m: (not m.get("live", False), str(m.get("starting_at") or "")))
    return {"provider": "cricketliveapi", "matches": filtered[:100], "count": min(len(filtered), 100)}

@api.get("/fantasy/matches/{match_id}")
async def fantasy_match_detail(match_id: str, user=Depends(get_current_user)):
    fixture, players = await _get_fantasy_fixture_players(match_id)
    return {"match": _normalize_fantasy_match(fixture), "players": players,
            "players_available": len(players), "team_selection_open": len(players) >= 11}

@api.get("/fantasy/matches/{match_id}/players")
async def fantasy_match_players(match_id: str, user=Depends(get_current_user)):
    _, players = await _get_fantasy_fixture_players(match_id)
    return {"match_id": str(match_id), "players": players, "players_available": len(players), "team_selection_open": len(players) >= 11}

@api.post("/fantasy/teams")
async def fantasy_create_team(payload: FantasyTeamCreateIn, user=Depends(get_current_user)):
    ids = [str(pid) for pid in payload.player_ids]
    if len(set(ids)) != 11: raise HTTPException(400, "Select 11 different players")
    if payload.captain_id not in ids or payload.vice_captain_id not in ids: raise HTTPException(400, "Captain and vice-captain must be in your selected 11")
    if payload.captain_id == payload.vice_captain_id: raise HTTPException(400, "Captain and vice-captain must be different players")
    _, available = await _get_fantasy_fixture_players(payload.match_id)
    by_id = {str(p["id"]): p for p in available}
    if any(pid not in by_id for pid in ids):
        raise HTTPException(400, "Selected players are not in this match's published lineup. Refresh after official lineup is announced.")
    selected = [by_id[pid] for pid in ids]
    counts = {}
    for player in selected:
        key = str(player.get("team_id") or "unknown")
        counts[key] = counts.get(key, 0) + 1
    if any(count > 7 for count in counts.values()): raise HTTPException(400, "Maximum 7 players can be selected from one real team")
    credits = round(sum(float(p.get("credits", 8.5)) for p in selected), 1)
    if credits > 100: raise HTTPException(400, f"Team exceeds 100 credits (selected {credits})")
    team = {"id": new_id(), "user_id": user["id"], "match_id": str(payload.match_id),
        "team_name": payload.team_name.strip() or "My Fantasy Team", "player_ids": ids, "players": selected,
        "captain_id": payload.captain_id, "vice_captain_id": payload.vice_captain_id,
        "credits_used": credits, "created_at": now_iso(), "updated_at": now_iso()}
    await db.fantasy_teams.insert_one(team.copy())
    return {"success": True, "team": team}

@api.get("/fantasy/teams")
async def fantasy_my_teams(match_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"user_id": user["id"]}
    if match_id: q["match_id"] = str(match_id)
    return await db.fantasy_teams.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)

@api.get("/fantasy/teams/{team_id}")
async def fantasy_get_team(team_id: str, user=Depends(get_current_user)):
    team = await db.fantasy_teams.find_one({"id": team_id, "user_id": user["id"]}, {"_id": 0})
    if not team: raise HTTPException(404, "Fantasy team not found")
    return team

async def _ensure_fantasy_contests(match_id: str):
    templates = [
        {"code": "practice", "name": "Practice Contest", "entry_fee": 0, "max_entries": 10000, "prizes": [100, 50, 25]},
        {"code": "starter", "name": "Starter Contest", "entry_fee": 50, "max_entries": 1000, "prizes": [500, 250, 100]},
        {"code": "pro", "name": "Pro Contest", "entry_fee": 100, "max_entries": 500, "prizes": [1000, 500, 250]},
    ]
    for item in templates:
        cid = f"{match_id}:{item['code']}"
        await db.fantasy_contests.update_one({"id": cid}, {"$setOnInsert": {
            "id": cid, "match_id": str(match_id), "code": item["code"], "name": item["name"],
            "entry_fee": item["entry_fee"], "max_entries": item["max_entries"], "prizes": item["prizes"],
            "status": "open", "settled": False, "created_at": now_iso()}}, upsert=True)

@api.get("/fantasy/contests")
async def fantasy_contests(match_id: str, user=Depends(get_current_user)):
    await _ensure_fantasy_contests(str(match_id))
    contests = await db.fantasy_contests.find({"match_id": str(match_id)}, {"_id": 0}).to_list(20)
    for c in contests:
        c["joined_count"] = await db.fantasy_entries.count_documents({"contest_id": c["id"]})
        c["joined"] = bool(await db.fantasy_entries.find_one({"contest_id": c["id"], "user_id": user["id"]}, {"_id": 1}))
    return contests

@api.post("/fantasy/contests/{contest_id}/join")
async def fantasy_join_contest(contest_id: str, payload: FantasyJoinContestIn, user=Depends(get_current_user)):
    contest = await db.fantasy_contests.find_one({"id": contest_id}, {"_id": 0})
    if not contest: raise HTTPException(404, "Contest not found")
    if contest.get("status") != "open" or contest.get("settled"): raise HTTPException(400, "This contest is closed")
    team = await db.fantasy_teams.find_one({"id": payload.team_id, "user_id": user["id"], "match_id": contest["match_id"]}, {"_id": 0})
    if not team: raise HTTPException(400, "Create a fantasy team for this match first")
    if await db.fantasy_entries.find_one({"contest_id": contest_id, "user_id": user["id"]}): raise HTTPException(409, "You have already joined this contest")
    if await db.fantasy_entries.count_documents({"contest_id": contest_id}) >= int(contest.get("max_entries", 1000)): raise HTTPException(400, "Contest is full")
    fee = int(contest.get("entry_fee", 0))
    await _fantasy_wallet(user["id"])
    if fee:
        # Atomically deduct entry fee from the same balance used by all existing games.
        debit = await db.users.update_one({"id": user["id"], "balance": {"$gte": fee}}, {"$inc": {"balance": -fee}})
        if debit.modified_count != 1: raise HTTPException(400, "Insufficient wallet balance")
        await _fantasy_coin_tx(user["id"], -fee, "contest_entry", {"contest_id": contest_id, "team_id": team["id"]})
    entry = {"id": new_id(), "contest_id": contest_id, "match_id": contest["match_id"], "user_id": user["id"],
        "team_id": team["id"], "team_name": team["team_name"], "created_at": now_iso()}
    try:
        await db.fantasy_entries.insert_one(entry.copy())
    except Exception:
        if fee:
            await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": fee}})
            await _fantasy_coin_tx(user["id"], fee, "contest_entry_refund", {"contest_id": contest_id, "reason": "duplicate entry race"})
        raise HTTPException(409, "Contest entry already exists")
    return {"success": True, "entry": entry, "wallet": await _fantasy_wallet(user["id"])}

def _as_list(value):
    """Normalize provider fields that can be a list or an included-data object."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        data = value.get("data")
        if isinstance(data, list):
            return data
        if value.get("id") is not None:
            return [value]
    return []


def _provider_player_id(row: dict) -> str:
    player = row.get("player")
    return str(row.get("player_id") or (player.get("id") if isinstance(player, dict) else None) or row.get("id") or "")


def _status_is_finished(status: Any) -> bool:
    if isinstance(status, dict):
        status = status.get("name") or status.get("short") or status.get("description") or ""
    value = str(status or "").strip().lower()
    return any(word in value for word in ("finished", "complete", "result", "abandoned", "cancelled", "canceled"))


async def _fantasy_points_for_match(match_id: str) -> tuple[dict, dict]:
    """Use the provider's fantasy points; do not infer points from scorecard fields."""
    fixture, squad = await _get_fantasy_fixture_players(match_id)
    points_rows = []
    last_error = None
    for endpoint in (f"fantasy/player-points/{match_id}", f"fantasy/live-score/{match_id}"):
        try:
            response = await _sportmonks_get(endpoint)
            rows = _sm_data(response)
            if isinstance(rows, dict):
                rows = rows.get("players", []) if isinstance(rows.get("players"), list) else []
            if isinstance(rows, list) and rows:
                points_rows = rows
                break
        except HTTPException as exc:
            last_error = exc
    if not points_rows and last_error:
        # Before the match starts the provider may not publish points yet; zero is valid then.
        logger.info("Fantasy points not published yet for %s: %s", match_id, last_error.detail)
    point_map = {str(p["id"]): {"points": float(p.get("points", 0) or 0), "name": p.get("name", "Player")} for p in squad}
    for row in points_rows:
        if not isinstance(row, dict): continue
        pid = str(row.get("player_id") or row.get("id") or "")
        if not pid: continue
        name = row.get("name") or row.get("fullname") or point_map.get(pid, {}).get("name", "Player")
        pts = row.get("fantasy_points", row.get("points", row.get("total_points", 0)))
        point_map[pid] = {"points": float(pts or 0), "name": str(name)}
    # Normalize provider status to the shape used by contest settlement.
    if isinstance(fixture, dict):
        fixture = dict(fixture)
        fixture["status"] = fixture.get("status") or fixture.get("match_status") or "Scheduled"
    return fixture, point_map

async def _build_fantasy_leaderboard(contest: dict) -> tuple[dict, list]:
    fixture, points = await _fantasy_points_for_match(str(contest["match_id"]))
    entries = await db.fantasy_entries.find({"contest_id": contest["id"]}, {"_id": 0}).to_list(2000)
    leaderboard = []
    for entry in entries:
        team = await db.fantasy_teams.find_one({"id": entry["team_id"]}, {"_id": 0})
        if not team:
            continue
        total = 0.0
        player_rows = []
        for pid in team.get("player_ids", []):
            player_score = float(points.get(str(pid), {}).get("points", 0))
            multiplier = (
                2.0 if str(pid) == str(team.get("captain_id"))
                else 1.5 if str(pid) == str(team.get("vice_captain_id"))
                else 1.0
            )
            scored = round(player_score * multiplier, 2)
            total += scored
            player_rows.append({
                "player_id": str(pid),
                "name": points.get(str(pid), {}).get("name", "Player"),
                "base_points": player_score,
                "multiplier": multiplier,
                "points": scored,
            })
        leaderboard.append({
            "user_id": entry["user_id"],
            "team_id": team["id"],
            "team_name": team["team_name"],
            "points": round(total, 2),
            "players": player_rows,
        })
    leaderboard.sort(key=lambda row: row["points"], reverse=True)
    previous_points = None
    current_rank = 0
    for index, row in enumerate(leaderboard, 1):
        if previous_points is None or row["points"] != previous_points:
            current_rank = index
        row["rank"] = current_rank
        previous_points = row["points"]
    return fixture, leaderboard


async def _settle_fantasy_contest(contest: dict, fixture: dict, leaderboard: list) -> bool:
    """Contest-level lock prevents concurrent leaderboard polls paying twice."""
    if not _status_is_finished(fixture.get("status")) or not leaderboard or contest.get("settled"):
        return bool(contest.get("settled"))
    lock = await db.fantasy_contests.update_one(
        {"id": contest["id"], "settled": {"$ne": True}, "status": {"$ne": "settling"}},
        {"$set": {"status": "settling", "settlement_started_at": now_iso()}},
    )
    if lock.modified_count != 1:
        latest = await db.fantasy_contests.find_one({"id": contest["id"]}, {"_id": 0, "settled": 1})
        return bool((latest or {}).get("settled"))

    try:
        prizes = contest.get("prizes", [])
        for idx, prize in enumerate(prizes):
            if idx >= len(leaderboard):
                break
            amount = int(prize)
            if amount <= 0:
                continue
            winner_id = leaderboard[idx]["user_id"]
            payout_key = f"{contest['id']}:{idx + 1}:{winner_id}"
            existing = await db.fantasy_prize_payouts.find_one({"payout_key": payout_key}, {"_id": 0})
            if existing and existing.get("status") == "paid":
                continue
            if not existing:
                try:
                    await db.fantasy_prize_payouts.insert_one({
                        "payout_key": payout_key, "contest_id": contest["id"],
                        "user_id": winner_id, "rank": idx + 1, "amount": amount,
                        "status": "pending", "created_at": now_iso(),
                    })
                except Exception:
                    existing = await db.fantasy_prize_payouts.find_one({"payout_key": payout_key}, {"_id": 0})
                    if existing and existing.get("status") == "paid":
                        continue
            await _fantasy_wallet(winner_id)
            await db.users.update_one({"id": winner_id}, {"$inc": {"balance": amount}})
            await _fantasy_coin_tx(winner_id, amount, "contest_prize", {
                "contest_id": contest["id"], "rank": idx + 1, "payout_key": payout_key,
            })
            await db.fantasy_prize_payouts.update_one(
                {"payout_key": payout_key},
                {"$set": {"status": "paid", "paid_at": now_iso()}},
            )
        await db.fantasy_contests.update_one(
            {"id": contest["id"]},
            {"$set": {"settled": True, "status": "completed", "settled_at": now_iso()}},
        )
        return True
    except Exception:
        logger.exception("Fantasy settlement failed for contest %s", contest["id"])
        raise


@api.get("/fantasy/matches/{match_id}/points")
async def fantasy_match_points(match_id: str, user=Depends(get_current_user)):
    fixture, points = await _fantasy_points_for_match(str(match_id))
    return {
        "match_id": str(match_id),
        "match_status": fixture.get("status"),
        "finished": _status_is_finished(fixture.get("status")),
        "updated_at": now_iso(),
        "players": [
            {"player_id": pid, "name": value["name"], "points": value["points"]}
            for pid, value in points.items()
        ],
    }


@api.get("/fantasy/contests/{contest_id}/leaderboard")
async def fantasy_leaderboard(contest_id: str, user=Depends(get_current_user)):
    contest = await db.fantasy_contests.find_one({"id": contest_id}, {"_id": 0})
    if not contest:
        raise HTTPException(404, "Contest not found")
    fixture, leaderboard = await _build_fantasy_leaderboard(contest)
    settled = await _settle_fantasy_contest(contest, fixture, leaderboard)
    return {
        "contest_id": contest_id,
        "match_id": contest["match_id"],
        "match_status": fixture.get("status"),
        "settled": settled,
        "updated_at": now_iso(),
        "leaderboard": leaderboard,
    }


async def fantasy_settlement_loop():
    """Settle completed matches even if nobody opens the leaderboard."""
    while True:
        try:
            cursor = db.fantasy_contests.find(
                {"settled": {"$ne": True}, "status": {"$in": ["open"]}},
                {"_id": 0},
            ).limit(100)
            async for contest in cursor:
                try:
                    fixture, leaderboard = await _build_fantasy_leaderboard(contest)
                    if _status_is_finished(fixture.get("status")):
                        await _settle_fantasy_contest(contest, fixture, leaderboard)
                except HTTPException as exc:
                    logger.warning("Fantasy settlement skipped for contest %s: %s", contest.get("id"), exc.detail)
                except Exception:
                    logger.exception("Fantasy settlement worker failed for contest %s", contest.get("id"))
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Fantasy settlement loop error")
            await asyncio.sleep(60)


# Root
@api.get("/")
async def root():
    return {"ok": True, "app": "Daman Gaming", "time": now_iso()}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
