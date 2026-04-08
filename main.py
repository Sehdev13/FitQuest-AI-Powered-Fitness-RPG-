from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
from recommender import recommender

app = FastAPI(title="FitQuest ML API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    print("Training ML model...")
    recommender.train()
    print("ML model ready!")

class UserProfile(BaseModel):
    age: int = 25
    weight_kg: float = 70
    goal: str = "general"
    fitness_level: str = "beginner"
    gym_days: int = 3
    streak: int = 0
    completion_rate: float = 0.5
    workouts_done: int = 0

class ExerciseEntry(BaseModel):
    name: str
    sets: int = 0
    reps: int = 0
    maxWeight: float = 0
    volume: float = 0

class WorkoutSession(BaseModel):
    date: str
    exercises: List[ExerciseEntry]

class AnalyzeRequest(BaseModel):
    history: List[WorkoutSession]

@app.get("/")
def root():
    return {"status": "FitQuest ML API is running!"}

@app.post("/recommend")
def get_recommendation(profile: UserProfile):
    try:
        result = recommender.predict(profile.dict())
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze")
def analyze_performance(req: AnalyzeRequest):
    try:
        history = [s.dict() for s in req.history]
        result = recommender.analyze_performance(history)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"ml_trained": recommender.is_trained, "status": "ok"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)