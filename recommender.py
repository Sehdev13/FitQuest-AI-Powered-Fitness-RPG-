import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

class FitnessRecommender:
    def __init__(self):
        self.intensity_model = RandomForestClassifier(n_estimators=100, random_state=42)
        self.focus_model = RandomForestClassifier(n_estimators=100, random_state=42)
        self.encoders = {}
        self.is_trained = False

    def prepare_features(self, df):
        for col in ['goal', 'fitness_level']:
            if col not in self.encoders:
                self.encoders[col] = LabelEncoder()
                df[col] = self.encoders[col].fit_transform(df[col])
            else:
                df[col] = self.encoders[col].transform(df[col])
        return df[['age','weight_kg','goal','fitness_level','gym_days','streak','completion_rate']]

    def train(self, data_path='data/fitness_data.csv'):
        df = pd.read_csv(data_path)
        X = self.prepare_features(df.copy())
        le_i = LabelEncoder()
        le_f = LabelEncoder()
        yi = le_i.fit_transform(df['recommended_intensity'])
        yf = le_f.fit_transform(df['recommended_focus'])
        self.encoders['intensity'] = le_i
        self.encoders['focus'] = le_f
        X_tr, X_te, yi_tr, yi_te = train_test_split(X, yi, test_size=0.2, random_state=42)
        _, _, yf_tr, yf_te = train_test_split(X, yf, test_size=0.2, random_state=42)
        self.intensity_model.fit(X_tr, yi_tr)
        self.focus_model.fit(X_tr, yf_tr)
        ia = accuracy_score(yi_te, self.intensity_model.predict(X_te))
        fa = accuracy_score(yf_te, self.focus_model.predict(X_te))
        self.is_trained = True
        print(f"Trained — Intensity: {ia:.0%}, Focus: {fa:.0%}")
        return {'intensity_accuracy': ia, 'focus_accuracy': fa}

    def predict(self, user_data: dict):
        if not self.is_trained:
            raise Exception("Model not trained yet")
        df = pd.DataFrame([user_data])
        for col in ['goal', 'fitness_level']:
            try:
                df[col] = self.encoders[col].transform(df[col])
            except ValueError:
                df[col] = 0
        X = df[['age','weight_kg','goal','fitness_level','gym_days','streak','completion_rate']]
        intensity = self.encoders['intensity'].inverse_transform([self.intensity_model.predict(X)[0]])[0]
        focus = self.encoders['focus'].inverse_transform([self.focus_model.predict(X)[0]])[0]
        confidence = round(float(max(self.intensity_model.predict_proba(X)[0])) * 100)
        tips = self._generate_tips(intensity, focus, user_data)
        return {'recommended_intensity':intensity,'recommended_focus':focus,'confidence':confidence,'tips':tips}

    def analyze_performance(self, history: list) -> dict:
        if not history:
            return {'insights':[], 'next_targets':[]}

        insights = []
        next_targets = []

        # Group by exercise
        ex_map = {}
        for session in history[-8:]:
            for ex in session.get('exercises', []):
                n = ex['name']
                if n not in ex_map:
                    ex_map[n] = []
                ex_map[n].append(ex)

        for name, sessions in ex_map.items():
            if len(sessions) < 2:
                continue
            last = sessions[-1]
            prev = sessions[-2]

            vol_change = 0
            if prev.get('volume', 0) > 0:
                vol_change = ((last.get('volume',0) - prev.get('volume',0)) / prev.get('volume',0)) * 100

            wgt_change = 0
            if prev.get('maxWeight', 0) > 0:
                wgt_change = ((last.get('maxWeight',0) - prev.get('maxWeight',0)) / prev.get('maxWeight',0)) * 100

            if vol_change >= 10:
                insights.append(f"{name}: Volume up {vol_change:.0f}% — excellent overload! Add 2.5kg next session.")
            elif vol_change <= -10:
                insights.append(f"{name}: Volume dropped {abs(vol_change):.0f}% — check recovery and sleep.")
            elif abs(vol_change) < 5:
                insights.append(f"{name}: Consistent volume — add 1 rep per set to break plateau.")

            suggested_weight = round(last.get('maxWeight',0) + (2.5 if vol_change >= 5 else 0), 1)
            next_targets.append({'exercise':name,'suggested_weight':suggested_weight,'trend':vol_change})

        return {'insights': insights[:4], 'next_targets': next_targets[:6]}

    def _generate_tips(self, intensity, focus, user):
        tips = []
        streak = user.get('streak', 0)
        completion = user.get('completion_rate', 0)
        goal = user.get('goal', '')
        workouts_done = user.get('workouts_done', 0)

        # Phase-aware tips
        if workouts_done < 8:
            tips.append("Phase 1: Focus on perfect form over weight — compound movements build your foundation")
        elif workouts_done < 16:
            tips.append("Phase 2: Upper/Lower split allows higher frequency — aim for progressive overload each session")
        elif workouts_done < 28:
            tips.append("Phase 3: PPL split increases volume per muscle — protein intake should be 1.8g per kg bodyweight")
        else:
            tips.append("Phase 4: Isolation focus — track every set and aim to beat last session's volume")

        if streak == 0:
            tips.append("Start with just 2 exercises today — building the habit matters more than intensity")
        elif streak < 7:
            tips.append(f"{streak}-day streak — aim for 7 consecutive days to unlock Week Warrior badge")
        elif streak >= 14:
            tips.append(f"Legendary {streak}-day streak — you are built different")

        if completion < 0.5:
            tips.append("Completion below 50% — shorten sessions before adding more exercises")
        elif completion > 0.85:
            tips.append("Elite completion rate — time to increase volume or move to next phase")

        goal_tips = {
            'build_muscle': "Prioritize 7-9 hours sleep — 80% of muscle growth happens overnight",
            'lose_weight': "A 300-500 calorie daily deficit is optimal for fat loss without muscle loss",
            'endurance': "80% of training at easy pace, 20% hard — this ratio maximizes aerobic adaptation",
            'general': "Consistency beats intensity every time — showing up matters most"
        }
        if goal in goal_tips:
            tips.append(goal_tips[goal])

        return tips[:3]

recommender = FitnessRecommender()