# FitQuest — AI-Powered Fitness RPG

🌐 **Live Demo:** [fitquest-1b34d.web.app](https://fitquest-1b34d.web.app)

---

## Objective

The purpose of this project was to build a full-stack AI-powered fitness web application that gamifies workout tracking using RPG mechanics, an on-device machine learning model, and a personalised LLM-powered AI coach — deployed live and accessible to anyone in the world for free.

---

## Project Overview

FitQuest turns real gym sessions into a Role Playing Game. Users create a hero character that physically evolves across 7 tiers as they complete workouts, earn XP, and level up. The app generates smart training schedules that automatically adapt based on the user's goals, equipment, and experience level — progressing through four training phases automatically. Every workout logged feeds real data into both a TensorFlow.js on-device neural network and ARIA (Adaptive Recovery & Intelligence Assistant), a branded AI coach powered by Groq's Llama 3.3 70B, which users can chat with to get data-driven coaching, injury modifications, and AI-generated schedule updates. The app also features automatic Personal Record detection with celebrations, a Friends system with competitive leaderboards, and a fully mobile-responsive design — all deployed on Firebase Hosting.

### Skills Demonstrated

- On-device machine learning model training and inference in the browser
- LLM integration with context-aware prompting using real user data
- Progressive model retraining on live user workout data
- Full-stack web development (frontend to cloud database to ML pipeline)
- NoSQL cloud database design and management
- REST API integration (Groq API, Firebase)
- User authentication and session management
- Data visualisation and performance analytics
- Responsive UI/UX design and mobile-first development
- Cloud deployment and hosting

---

## Tools Used

- **JavaScript (ES6+)** — primary programming language for all frontend and app logic
- **TensorFlow.js** — on-device neural network training and inference in the browser
- **Groq API + Llama 3.3 70B** — LLM backend powering the ARIA AI coach
- **Python + FastAPI** — optional local ML backend server
- **scikit-learn + pandas + NumPy** — Python-based RandomForest recommendation model
- **Firebase Firestore** — NoSQL cloud database storing all user data in real time
- **Firebase Authentication** — Google OAuth sign-in
- **Firebase Hosting** — live deployment and CDN hosting
- **Chart.js** — progress forecasting charts and data visualisation
- **HTML5 + CSS3** — structure and responsive styling

---

## Steps & Evidence

### 1. User Onboarding & Profile Setup

A 3-step onboarding flow collects the user's hero name, fitness goal (Lose Weight / Build Muscle / Endurance / General), gym days (Mon–Sun toggle), fitness level (Beginner / Intermediate / Advanced), and equipment availability (Full Gym / Home / Bodyweight). All data is saved to Firebase Firestore and used as input for the schedule builder and ML model.

---

### 2. Smart Schedule Builder

A rule-based schedule generation engine builds a personalised weekly training plan based on gym frequency, goal, fitness level, and equipment. Volume scales inversely with frequency — users training 2 days get higher volume per session than users training 6 days. Sets and reps also adjust per goal.

| Days/Week | Split Type | Exercises/Session | Sets |
|---|---|---|---|
| 2–3 | Full Body | 6–8 | 4 |
| 4 | Upper/Lower | 5 | 3 |
| 5 | Push/Pull/Legs | 4 | 3 |
| 6 | PPL × 2 | 4 | 3 |
| 7 | Micro Sessions | 3 | 2 |

---

### 3. Progressive Training Phases

The app automatically advances the user through 4 training phases as they complete more workouts. When a phase threshold is crossed, the schedule rebuilds automatically.

| Phase | Trigger | Split |
|---|---|---|
| Phase 1 — Full Body | 0–7 workouts | All muscles every session |
| Phase 2 — Upper/Lower | 8–15 workouts | Alternate upper and lower |
| Phase 3 — Push/Pull/Legs | 16–27 workouts | 3-way split |
| Phase 4 — Isolation | 28+ workouts | Targeted muscle groups |

---

### 4. On-Device ML Model (TensorFlow.js)

A neural network runs entirely in the browser using TensorFlow.js — no server required. It trains on 30 synthetic data points initially, then progressively replaces them with the user's real workout data. After every workout logged, `retrainOnNewData()` fine-tunes the model on 20 epochs of actual session data.

**10 input features:**
- Streak score, Level score, Attendance rate, Planned frequency
- Average volume per session, Average sets per session
- Progressive overload trend, Volume trend
- Muscle group coverage score, Total experience

**3 outputs:** Difficulty recommendation, Training quality score, Progress forecast

---

### 5. ARIA AI Coach (LLM Integration)

ARIA (Adaptive Recovery & Intelligence Assistant) is FitQuest's branded AI coach powered by Groq's Llama 3.3 70B under the hood. Before every response, ARIA receives a system prompt containing the user's full profile, workout history with exercise-level data (weights, volumes, trends), personal records, current schedule, and current training phase — giving it full context to provide genuinely personalised advice rather than generic tips. ARIA can also generate schedule updates that apply directly to the user's plan with one tap.

---

### 6. Workout Logging & Performance Comparison

Users can log workouts via Quick Log (`Bench Press 3×10×80` format) or a Detailed Log with individual sets. After every log, the app compares today's performance vs the last session for the same exercise — showing volume % change, max weight % change, and a coaching tip.

| Result | Tip |
|---|---|
| Volume up 5%+ | Add 2.5kg next session |
| Volume down | Check recovery and sleep |
| Same | Try 1 more rep per set |

---

### 7. Personal Records System

Every time a user logs a weight higher than their previous best on any exercise, the app automatically detects the PR, shows a confetti celebration modal, awards +30 bonus XP, and saves the record with date and improvement amount. The PR tab shows all-time bests per exercise with gold cards and 🆕 badges for PRs set in the last 3 days.

---

### 8. SVG Avatar Evolution

A fully hand-coded SVG character renders in the right panel and evolves visually as the user levels up — no external images used.

| Level | Tier | Visual Changes |
|---|---|---|
| 0 | Beginner | Blue t-shirt, slim build |
| 3 | Trainee | Shirt off, shoes appear |
| 7 | Fighter | Gloves, muscle definition |
| 12 | Athlete | Belt, scar, 3 rows of abs |
| 20 | Champion | Tattoo, purple outfit |
| 30 | Beast | Flames at feet, wrist wraps |
| 50 | Legend | Crown, golden eyes, god aura |

---

### 9. Friends & Leaderboard System

Every user gets a unique `FQ-XXXXX` code on signup. Users share their code, send friend requests, accept or decline — and once connected, appear on a leaderboard ranked by level showing streak and best PR lift. Gold, silver, and bronze medals are awarded to the top 3 players.

---

### 10. Deployment

The full app is deployed live on Firebase Hosting and accessible to anyone in the world. All user data is stored in Firebase Firestore with per-user isolation. Google OAuth handles authentication. Every future update deploys in one command.

```powershell
firebase deploy --only hosting
```

**Live URL:** [fitquest-1b34d.web.app](https://fitquest-1b34d.web.app)

---

## Project Structure
FitQuest/
├── index.html              ← All screens (login, onboarding, dashboard)
├── style.css               ← All styling and mobile responsive design
├── app.js                  ← Game logic, Firebase, avatar, ARIA, PRs, friends
├── ml.js                   ← TF.js model, training, insights rendering
├── fitquest-intro2.mp4     ← Login screen background video
├── firebase.json           ← Firebase Hosting config
└── ml-backend/
├── main.py             ← FastAPI server
├── recommender.py      ← Python ML model (RandomForest)
└── venv/               ← Python virtual environment

---

## Getting Started

### Live Version
Visit **[fitquest-1b34d.web.app](https://fitquest-1b34d.web.app)** — sign in with Google and start immediately.

### Run Locally
```bash
# Clone the repo
git clone https://github.com/Sehdev13/FitQuest-AI-Powered-Fitness-RPG.git

# Open in VS Code
cd FitQuest-AI-Powered-Fitness-RPG

# Right click index.html → Open with Live Server
```

### ARIA Setup
1. Get a free API key at [console.groq.com](https://console.groq.com)
2. In `app.js` line 6, replace:
```js
const GROQ_API_KEY = 'YOUR_GROQ_API_KEY_HERE';
```

### Optional Python Backend
```bash
cd ml-backend
python -m venv venv
venv\Scripts\activate
pip install fastapi uvicorn scikit-learn pandas numpy
python main.py
# Runs at http://localhost:8000
```

---

## Roadmap

- [ ] PWA support — installable on phone home screen
- [ ] Body measurements tracker with progress graphs
- [ ] Built-in workout rest timer
- [ ] ARIA voice mode using Web Speech API
- [ ] Weekly ARIA progress report card
- [ ] Workout history calendar heatmap

---

## Author

**Sehdev** — [github.com/Sehdev13](https://github.com/Sehdev13)

---

## License

MIT License — free to use and modify.

---

*Built with 💪 and a lot of reps.*
