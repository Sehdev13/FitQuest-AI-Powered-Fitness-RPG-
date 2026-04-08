let tfModel = null;
let chartInstance = null;
const ML_API = 'http://localhost:8000';

// ── Feature extraction from real workout history ──
// Builds a rich feature vector from the user's actual logged data
function extractFeaturesFromHistory(state) {
    const history = state.workoutHistory || [];
    const gymDays = state.gymDays || [];

    // --- Frequency features ---
    const plannedDays  = gymDays.length;
    const totalSessions= history.length;
    const last7Days    = history.filter(h => {
        const d = new Date(h.date);
        const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
        return diff <= 7;
    }).length;
    const actualFreq   = last7Days / 7; // 0-1, how often they actually showed up

    // --- Volume features ---
    let totalVolume = 0, totalSets = 0, totalReps = 0, sessionCount = 0;
    const exerciseMap = {}; // name → [{ date, volume, maxWeight, sets, reps }]

    history.forEach(session => {
        (session.exercises || []).forEach(ex => {
            totalVolume += ex.volume || 0;
            totalSets   += ex.sets   || 0;
            totalReps   += ex.reps   || 0;
            sessionCount++;
            if (!exerciseMap[ex.name]) exerciseMap[ex.name] = [];
            exerciseMap[ex.name].push({
                date:      session.date,
                volume:    ex.volume    || 0,
                maxWeight: ex.maxWeight || 0,
                sets:      ex.sets      || 0,
                reps:      ex.reps      || 0,
            });
        });
    });

    const avgVolumePerSession = sessionCount > 0 ? totalVolume / history.length : 0;
    const avgSetsPerSession   = sessionCount > 0 ? totalSets   / history.length : 0;

    // --- Progressive overload detection ---
    // For each exercise track if weight is trending up
    let overloadScore = 0, overloadCount = 0;
    Object.values(exerciseMap).forEach(sessions => {
        if (sessions.length < 2) return;
        const sorted = sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
        const first  = sorted[0].maxWeight;
        const last   = sorted[sorted.length - 1].maxWeight;
        if (first > 0) {
            overloadScore += (last - first) / first; // % improvement
            overloadCount++;
        }
    });
    const avgOverload = overloadCount > 0 ? Math.min(overloadScore / overloadCount, 1) : 0;

    // --- Consistency features ---
    const streak      = Math.min(state.currentStreak || 0, 30) / 30;
    const level       = Math.min(state.level         || 0, 50) / 50;
    const completion  = plannedDays > 0
        ? Math.min(last7Days / Math.max(plannedDays, 1), 1)
        : 0.3;

    // --- Volume trend (last 2 sessions vs previous 2) ---
    let volumeTrend = 0.5;
    if (history.length >= 4) {
        const recent = history.slice(-2).reduce((a, h) =>
            a + (h.exercises || []).reduce((b, e) => b + (e.volume || 0), 0), 0);
        const older  = history.slice(-4, -2).reduce((a, h) =>
            a + (h.exercises || []).reduce((b, e) => b + (e.volume || 0), 0), 0);
        volumeTrend = older > 0 ? Math.min(recent / older, 2) / 2 : 0.5;
    }

    // --- Muscle group coverage ---
    const muscleGroups = {
        chest: ['bench press','incline','fly','push-up','dip','pec'],
        back:  ['deadlift','row','pull','lat','chin'],
        legs:  ['squat','lunge','leg press','leg curl','leg extension','calf','hip thrust','romanian'],
        shoulders: ['overhead','shoulder press','lateral raise','front raise','rear delt'],
        arms:  ['curl','tricep','skull','hammer'],
        core:  ['plank','ab','crunch','russian','hanging leg'],
    };
    const groupHit = {};
    Object.entries(muscleGroups).forEach(([group, keywords]) => {
        groupHit[group] = Object.keys(exerciseMap).some(name =>
            keywords.some(kw => name.toLowerCase().includes(kw))
        );
    });
    const muscleBalance = Object.values(groupHit).filter(Boolean).length / 6; // 0-1

    // Return full feature vector (10 features) + metadata
    return {
        features: [
            streak,                                          // 0: streak score
            level,                                          // 1: level score
            completion,                                     // 2: actual attendance rate
            plannedDays / 7,                                // 3: planned frequency
            Math.min(avgVolumePerSession / 10000, 1),       // 4: avg volume per session
            Math.min(avgSetsPerSession / 30, 1),            // 5: avg sets
            avgOverload,                                    // 6: progressive overload trend
            volumeTrend,                                    // 7: recent volume trend
            muscleBalance,                                  // 8: muscle group coverage
            Math.min(totalSessions / 50, 1),                // 9: total experience
        ],
        meta: {
            exerciseMap,
            groupHit,
            avgVolumePerSession,
            avgOverload,
            volumeTrend,
            muscleBalance,
            actualFreq,
            plannedDays,
            last7Days,
        }
    };
}

// ── Generate training data from real history + synthetic augmentation ──
function generateTrainingData(state) {
    const xs = [], ys = [];
    const history = state.workoutHistory || [];

    // --- Learn from REAL sessions ---
    history.forEach((session, idx) => {
        const exs     = session.exercises || [];
        if (!exs.length) return;

        const vol     = exs.reduce((a, e) => a + (e.volume    || 0), 0);
        const sets    = exs.reduce((a, e) => a + (e.sets      || 0), 0);
        const prevSessions = history.slice(0, idx);

        // Streak at that point
        let streak = 0;
        for (let i = idx - 1; i >= 0; i--) {
            const gap = (new Date(history[i+1]?.date || session.date) - new Date(history[i].date)) / 86400000;
            if (gap <= 2) streak++; else break;
        }

        // Volume compared to personal average
        const pastVols = prevSessions.map(s =>
            (s.exercises || []).reduce((a, e) => a + (e.volume || 0), 0)
        ).filter(v => v > 0);
        const avgVol   = pastVols.length ? pastVols.reduce((a,b)=>a+b,0)/pastVols.length : vol;
        const volRatio = avgVol > 0 ? Math.min(vol / avgVol, 2) / 2 : 0.5;

        // Progressive overload at that point
        const overloadHits = exs.filter(ex => {
            const prev = prevSessions.flatMap(s => s.exercises || [])
                .filter(e => e.name === ex.name && e.maxWeight > 0);
            if (!prev.length) return false;
            const lastW = prev[prev.length - 1].maxWeight;
            return (ex.maxWeight || 0) > lastW;
        }).length;
        const overload = exs.length > 0 ? overloadHits / exs.length : 0;

        const normStreak  = Math.min(streak, 30) / 30;
        const normLevel   = Math.min(state.level, 50) / 50;
        const normSets    = Math.min(sets / 30, 1);
        const normDays    = (state.gymDays || []).length / 7;
        const normVol     = Math.min(vol / 10000, 1);
        const normExp     = Math.min(idx / 50, 1);

        xs.push([normStreak, normLevel, volRatio, normDays, normVol, normSets, overload, volRatio, 0.5, normExp]);

        // Labels derived from actual performance
        const diff     = volRatio > 0.8 ? Math.min(volRatio * 1.1, 1) : Math.max(volRatio * 0.8, 0.2);
        const rec      = normStreak > 0.5 ? 0.85 : normStreak > 0.25 ? 0.65 : 0.45;
        const forecast = Math.min(normStreak * 0.3 + volRatio * 0.4 + overload * 0.3, 1);
        ys.push([diff, rec, forecast]);
    });

    // --- Augment with synthetic data if real data is sparse (<10 sessions) ---
    const needed = Math.max(0, 30 - xs.length);
    for (let i = 0; i < needed; i++) {
        const streak     = Math.random() * 30;
        const lvl        = Math.random() * 50;
        const completion = Math.random();
        const days       = Math.random() * 7;
        const vol        = Math.random();
        const sets       = Math.random();
        const overload   = Math.random() * 0.5;
        const trend      = 0.4 + Math.random() * 0.2;
        const balance    = Math.random();
        const exp        = Math.random();
        xs.push([streak/30, lvl/50, completion, days/7, vol, sets, overload, trend, balance, exp]);
        const diff     = completion > 0.8 ? Math.min(completion*1.2,1) : Math.max(completion*0.7,0.2);
        const rec      = streak > 14 ? 0.9 : streak > 7 ? 0.7 : 0.5;
        const forecast = Math.min(streak*0.02 + completion*0.4 + overload*0.3 + exp*0.3, 1);
        ys.push([diff, rec, forecast]);
    }

    return { xs, ys };
}

// ── Train / retrain model ──
export async function trainModel(onStatusUpdate, state = null) {
    onStatusUpdate('CONNECTING...');
    const backendAlive = await checkBackend();
    if (backendAlive) { onStatusUpdate('ML READY'); return; }

    onStatusUpdate('TRAINING LOCAL...');
    try {
        const { xs, ys } = state && (state.workoutHistory||[]).length >= 3
            ? generateTrainingData(state)
            : generateTrainingData({ workoutHistory:[], gymDays:['Mon','Wed','Fri'], level:0 });

        const features = tf.tensor2d(xs);
        const labels   = tf.tensor2d(ys);

        // Dispose old model
        if (tfModel) { try { tfModel.dispose(); } catch(e) {} }

        tfModel = tf.sequential();
        tfModel.add(tf.layers.dense({ inputShape:[10], units:32, activation:'relu' }));
        tfModel.add(tf.layers.dropout({ rate: 0.1 }));
        tfModel.add(tf.layers.dense({ units:16, activation:'relu' }));
        tfModel.add(tf.layers.dense({ units:8,  activation:'relu' }));
        tfModel.add(tf.layers.dense({ units:3,  activation:'sigmoid' }));
        tfModel.compile({ optimizer: tf.train.adam(0.008), loss:'meanSquaredError' });

        const epochs = state && (state.workoutHistory||[]).length >= 10 ? 80 : 50;
        await tfModel.fit(features, labels, { epochs, verbose:0 });
        features.dispose();
        labels.dispose();

        onStatusUpdate('ML READY');
        console.log(`✅ Model trained on ${xs.length} samples (${(state?.workoutHistory||[]).length} real sessions)`);
    } catch(e) {
        console.error('TF error:', e);
        onStatusUpdate('ML ACTIVE');
    }
}

// ── Retrain on new workout data (called after every log) ──
export async function retrainOnNewData(state) {
    if (!state.workoutHistory || state.workoutHistory.length < 2) return;
    try {
        const { xs, ys } = generateTrainingData(state);
        const features = tf.tensor2d(xs);
        const labels   = tf.tensor2d(ys);
        if (!tfModel) { features.dispose(); labels.dispose(); return; }
        // Fine-tune existing model with fewer epochs
        await tfModel.fit(features, labels, { epochs:20, verbose:0 });
        features.dispose();
        labels.dispose();
        console.log('🔄 Model fine-tuned on new workout data');
    } catch(e) {
        console.error('Retrain error:', e);
    }
}

async function checkBackend() {
    try {
        const res  = await fetch(`${ML_API}/health`, { signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        return data.ml_trained === true;
    } catch { return false; }
}

export async function fetchRealRecommendation(state) {
    try {
        const gymDays = state.gymDays ? state.gymDays.length : 3;
        const { meta } = extractFeaturesFromHistory(state);
        const res = await fetch(`${ML_API}/recommend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                age: 25, weight_kg: 70,
                goal: state.goal || 'general',
                fitness_level: state.fitnessLevel || 'beginner',
                gym_days: gymDays,
                streak: state.currentStreak || 0,
                completion_rate: parseFloat((meta.actualFreq || 0.3).toFixed(2)),
                avg_volume: Math.round(meta.avgVolumePerSession || 0),
                overload_trend: parseFloat((meta.avgOverload || 0).toFixed(2)),
                muscle_balance: parseFloat((meta.muscleBalance || 0).toFixed(2)),
                today_exercise_count: (state.schedule?.[(
                    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()]
                )] || []).length
            })
        });
        const data = await res.json();
        return data.success ? data.data : null;
    } catch { return null; }
}

export function getMLPrediction(state) {
    if (!tfModel) return { difficulty:0.5, recommendation:0.5, forecast:0.5 };
    const { features } = extractFeaturesFromHistory(state);
    const input = tf.tensor2d([features]);
    const pred  = tfModel.predict(input);
    const vals  = pred.dataSync();
    input.dispose();
    pred.dispose();
    return { difficulty:vals[0], recommendation:vals[1], forecast:vals[2] };
}

// ── Analyse real workout data for specific insights ──
function analyseWorkoutData(state) {
    const history = state.workoutHistory || [];
    const { meta } = extractFeaturesFromHistory(state);
    const { exerciseMap, groupHit } = meta;

    const insights = [];
    const today    = new Date().toISOString().split('T')[0];

    // 1. Progressive overload per exercise
    Object.entries(exerciseMap).forEach(([name, sessions]) => {
        if (sessions.length < 2) return;
        const sorted  = [...sessions].sort((a,b) => new Date(a.date)-new Date(b.date));
        const last    = sorted[sorted.length-1];
        const prev    = sorted[sorted.length-2];
        if (last.date === today) return; // skip today's data
        if (prev.maxWeight > 0 && last.maxWeight > 0) {
            const diff = ((last.maxWeight - prev.maxWeight) / prev.maxWeight * 100).toFixed(1);
            const suggested = (last.maxWeight + 2.5).toFixed(1);
            if (parseFloat(diff) > 0) {
                insights.push({ type:'overload', icon:'💪', text:`${name}: up ${diff}% last session → try ${suggested}kg today`, priority:1 });
            } else if (parseFloat(diff) < 0) {
                insights.push({ type:'drop', icon:'⚠️', text:`${name}: weight dropped ${Math.abs(diff)}% — check form or reduce fatigue`, priority:2 });
            } else {
                insights.push({ type:'stall', icon:'🎯', text:`${name}: same weight 2+ sessions → time to add 2.5kg`, priority:3 });
            }
        }
    });

    // 2. Neglected muscle groups
    const neglected = Object.entries(groupHit)
        .filter(([_, hit]) => !hit)
        .map(([group]) => group);
    if (neglected.length > 0) {
        insights.push({
            type:'neglect', icon:'🔍',
            text:`Neglected muscles: ${neglected.join(', ')} — add these to avoid imbalances`,
            priority: 2
        });
    }

    // 3. Volume trend
    if (meta.volumeTrend > 0.6) {
        insights.push({ type:'volume', icon:'📈', text:`Volume trending up ${Math.round((meta.volumeTrend-0.5)*200)}% — great progressive overload!`, priority:1 });
    } else if (meta.volumeTrend < 0.4) {
        insights.push({ type:'volume', icon:'📉', text:`Volume dropped ${Math.round((0.5-meta.volumeTrend)*200)}% recently — consider a deload or more rest`, priority:2 });
    }

    // 4. Attendance vs plan
    if (meta.plannedDays > 0) {
        const attendRate = Math.round((meta.actualFreq / (meta.plannedDays/7)) * 100);
        if (attendRate < 70) {
            insights.push({ type:'attend', icon:'📅', text:`Attendance: ${meta.last7Days}/${meta.plannedDays} days this week — try reducing to ${Math.max(2, meta.plannedDays-1)} days if schedule is tight`, priority:2 });
        } else if (attendRate >= 100) {
            insights.push({ type:'attend', icon:'🔥', text:`Perfect attendance this week! You hit all ${meta.plannedDays} planned sessions`, priority:1 });
        }
    }

    // 5. Suggest exercises the model doesn't recommend but user hasn't done
    const allUserExercises = new Set(Object.keys(exerciseMap).map(n => n.toLowerCase()));
    const suggestByGroup = {
        chest:     'Cable Fly',
        back:      'Face Pulls',
        legs:      'Hip Thrust',
        shoulders: 'Rear Delt Fly',
        arms:      'Hammer Curls',
        core:      'Hanging Leg Raise',
    };
    Object.entries(suggestByGroup).forEach(([group, exercise]) => {
        if (groupHit[group] && !allUserExercises.has(exercise.toLowerCase())) {
            insights.push({ type:'suggest', icon:'➕', text:`Try adding ${exercise} to hit ${group} from a new angle`, priority:3 });
        }
    });

    return insights.sort((a,b) => a.priority - b.priority);
}

export async function renderMLInsights(state, xpNeeded, drawChart) {
    document.getElementById('mlLoadingBlock').style.display = 'none';
    document.getElementById('mlReadyBlock').style.display  = 'block';
    const realRec = await fetchRealRecommendation(state);
    const pred    = getMLPrediction(state);
    state.mlScore = Math.round(pred.forecast * 100);
    const insights = analyseWorkoutData(state);
    renderRecommendations(pred, state.goal, realRec, state, insights);
    renderDifficulty(pred, state, realRec);
    renderForecast(pred, state, xpNeeded, drawChart);
    return state.mlScore;
}

function getTodayExerciseCount(state) {
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const key  = DAYS[new Date().getDay()];
    return (state?.schedule?.[key] || []).length;
}

function renderRecommendations(pred, goal, realRec, state, insights) {
    const todayCount = getTodayExerciseCount(state);
    const isRestDay  = todayCount === 0;
    const hasHistory = (state.workoutHistory || []).length >= 2;
    let html = '';

    // ── Data-driven insights from real workout history ──
    if (hasHistory && insights.length > 0) {
        html += `<div style="font-size:10px;color:var(--gn);font-weight:800;letter-spacing:1px;margin-bottom:6px;">
            🧠 PERSONALISED FROM YOUR ${state.workoutHistory.length} SESSIONS
        </div>`;
        html += insights.slice(0, 4).map(ins =>
            `<div class="insight-row">
                <div class="insight-dot" style="background:${ins.type==='overload'?'var(--gn)':ins.type==='drop'||ins.type==='neglect'?'var(--rd)':'var(--or)'};"></div>
                <div class="insight-text">${ins.icon} ${ins.text}</div>
            </div>`
        ).join('');
        html += `<div style="height:1px;background:var(--br);margin:10px 0;"></div>`;
    }

    // ── Backend ML result ──
    if (realRec) {
        const intensityColors = { low:'var(--gn)', medium:'var(--or)', high:'var(--rd)', very_high:'var(--pu)' };
        const col = intensityColors[realRec.recommended_intensity] || 'var(--bl)';
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px 10px;background:rgba(68,136,255,0.08);border-radius:10px;border:1px solid rgba(68,136,255,0.2);">
            <div style="font-size:10px;color:var(--mt);font-weight:700;">BACKEND ML</div>
            <div style="font-size:11px;font-weight:800;color:${col};text-transform:uppercase;">${realRec.recommended_intensity} intensity</div>
            <div style="font-size:10px;color:var(--mt);">· ${realRec.recommended_focus} focus</div>
            <div style="margin-left:auto;font-size:10px;color:var(--gn);font-weight:700;">${realRec.confidence}% conf</div>
        </div>`;
        const safeTips = (realRec.tips || []).filter(t => {
            const tl = t.toLowerCase();
            if (todayCount >= 3 && (tl.includes('just 2')||tl.includes('2 exercises'))) return false;
            if (!isRestDay && tl.includes('rest day')) return false;
            return true;
        });
        html += safeTips.map(t =>
            `<div class="insight-row"><div class="insight-dot" style="background:var(--bl);"></div><div class="insight-text">💡 ${t}</div></div>`
        ).join('');

    } else {
        // ── Schedule-aware local tips ──
        if (!isRestDay) {
            const xpBonus = todayCount * 20 + 50;
            html += `<div class="insight-row">
                <div class="insight-dot" style="background:var(--or);"></div>
                <div class="insight-text">📋 ${todayCount} exercises today — complete all for +${xpBonus} XP</div>
            </div>`;
        } else {
            html += `<div class="insight-row">
                <div class="insight-dot" style="background:var(--mt);"></div>
                <div class="insight-text">💤 Rest day — recovery is where muscle grows</div>
            </div>`;
        }

        // Generic goal tips (only if no personalised insights)
        if (!hasHistory) {
            const score = pred.recommendation;
            const pool  = {
                build_muscle: [
                    { icon:'💪', text:'Log your first workout to unlock personalised progressive overload tracking', cond:true },
                    { icon:'🥩', text:'Ensure 1.6g protein per kg bodyweight to support muscle growth', cond:score>0.5 },
                ],
                lose_weight: [
                    { icon:'🔥', text:'Log your workouts to get personalised calorie-burn insights', cond:true },
                    { icon:'⚡', text:'Superset exercises to keep heart rate elevated', cond:score>0.5 },
                ],
                endurance: [
                    { icon:'🏃', text:'Log your sessions to track aerobic base development', cond:true },
                ],
                general: [
                    { icon:'⭐', text:'Log your first workout — the model will personalise to your data', cond:true },
                ],
            };
            const tips = (pool[goal]||pool.general).filter(r=>r.cond).slice(0,2);
            html += tips.map(r=>
                `<div class="insight-row"><div class="insight-dot" style="background:var(--bl);"></div><div class="insight-text">${r.icon} ${r.text}</div></div>`
            ).join('');
        }
    }

    document.getElementById('recList').innerHTML = html;
}

function renderDifficulty(pred, state, realRec) {
    const { meta } = extractFeaturesFromHistory(state);
    const d = pred.difficulty;
    let label, cls, advice;

    // Use real volume trend to calibrate advice
    if (meta.volumeTrend > 0.6 || d > 0.65) {
        label  = 'PUSH HARDER';  cls = 'diff-hard';
        advice = meta.avgVolumePerSession > 0
            ? `Your avg session volume is ${Math.round(meta.avgVolumePerSession)}kg — try adding 1 more set per compound lift`
            : 'You are progressing well — add 2.5kg to your main lifts';
    } else if (meta.volumeTrend < 0.4 || d < 0.35) {
        label  = 'RECOVER';      cls = 'diff-easy';
        advice = 'Volume trending down — prioritise sleep, protein, and deload if needed';
    } else {
        label  = 'OPTIMAL';      cls = 'diff-med';
        advice = meta.avgVolumePerSession > 0
            ? `Consistent ${Math.round(meta.avgVolumePerSession)}kg avg volume — maintain and add 1 rep per set`
            : 'Current difficulty is well calibrated for your level';
    }

    if (realRec) {
        const map    = { low:'RECOVER', medium:'OPTIMAL', high:'PUSH HARDER', very_high:'PUSH HARDER' };
        const clsMap = { low:'diff-easy', medium:'diff-med', high:'diff-hard', very_high:'diff-hard' };
        label = map[realRec.recommended_intensity]    || label;
        cls   = clsMap[realRec.recommended_intensity] || cls;
    }

    const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div>
            <div style="font-size:11px;color:var(--mt);font-weight:700;margin-bottom:4px;">TODAY'S DIFFICULTY</div>
            <span class="difficulty-badge ${cls}">${label}</span>
        </div>
        <div style="text-align:right;">
            <div style="font-size:10px;color:var(--mt);font-weight:700;margin-bottom:2px;">CONFIDENCE</div>
            <div style="font-family:'Bangers',cursive;font-size:22px;color:var(--gn);">${
                realRec ? realRec.confidence : Math.round(50 + (state.workoutHistory||[]).length * 2 + pred.recommendation * 20)
            }%</div>
        </div>
    </div>
    <div style="font-size:12px;color:var(--tx);margin-bottom:10px;">💡 ${advice}</div>`;

    // Muscle group balance bars
    if (meta.groupHit && Object.keys(meta.groupHit).length) {
        html += `<div style="font-size:10px;color:var(--mt);font-weight:700;margin-bottom:6px;">MUSCLE GROUP COVERAGE</div>`;
        Object.entries(meta.groupHit).forEach(([group, hit]) => {
            const color = hit ? 'var(--gn)' : 'var(--rd)';
            html += `<div class="prog-bar-wrap">
                <div class="prog-bar-label"><span style="text-transform:capitalize;">${group}</span><span style="color:${color};">${hit?'✓ Trained':'✗ Missing'}</span></div>
                <div class="prog-bar"><div class="prog-fill" style="width:${hit?100:15}%;background:${color};"></div></div>
            </div>`;
        });
        html += `<div style="height:1px;background:var(--br);margin:8px 0;"></div>`;
    }

    // Completion rate by day
    html += `<div style="font-size:10px;color:var(--mt);font-weight:700;margin-bottom:6px;">COMPLETION BY DAY</div>`;
    DAYS.forEach(d => {
        const exs = state.schedule[d] || [];
        if (!exs.length) return;
        let dc = 0;
        exs.forEach((_,i) => { if (state.completedEx[d+'_'+i]) dc++; });
        const pct   = Math.round((dc / exs.length) * 100);
        const color = pct > 70 ? 'var(--gn)' : pct > 40 ? 'var(--or)' : 'var(--rd)';
        html += `<div class="prog-bar-wrap">
            <div class="prog-bar-label"><span>${d}</span><span>${pct}%</span></div>
            <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${color};"></div></div>
        </div>`;
    });

    document.getElementById('diffContent').innerHTML = html;
}

function renderForecast(pred, state, xpNeeded, drawChart) {
    const fc      = pred.forecast;
    const curLvl  = state.level;
    const history = state.workoutHistory || [];
    const { meta }= extractFeaturesFromHistory(state);

    const daysToNext = Math.max(1, Math.round(
        (xpNeeded(curLvl) - state.xp) / (20 * Math.max(1, state.gymDays.length) * Math.max(fc, 0.1))
    ));
    const goalDays    = { lose_weight:90, build_muscle:120, endurance:60, general:90 };
    const elapsed     = state.workoutsDone * 2;
    const progressPct = Math.min(100, Math.round((elapsed / (goalDays[state.goal]||90)) * 100));
    const predicted30 = Math.min(curLvl + Math.round(fc * 8), curLvl + 12);

    // Real stats from history
    const totalVolume = history.reduce((a,h) =>
        a + (h.exercises||[]).reduce((b,e) => b+(e.volume||0), 0), 0);
    const totalSessions = history.length;
    const avgVol = totalSessions > 0 ? Math.round(totalVolume / totalSessions) : 0;

    document.getElementById('forecastContent').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            <div style="text-align:center;background:var(--cd2);border-radius:10px;padding:8px;">
                <div style="font-size:10px;color:var(--mt);font-weight:700;margin-bottom:2px;">NEXT LEVEL IN</div>
                <div style="font-family:'Bangers',cursive;font-size:24px;color:var(--pu);">${daysToNext}d</div>
            </div>
            <div style="text-align:center;background:var(--cd2);border-radius:10px;padding:8px;">
                <div style="font-size:10px;color:var(--mt);font-weight:700;margin-bottom:2px;">30-DAY LEVEL</div>
                <div style="font-family:'Bangers',cursive;font-size:24px;color:var(--pu);">LV ${predicted30}</div>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
            <div style="text-align:center;background:var(--cd2);border-radius:8px;padding:6px;">
                <div style="font-size:9px;color:var(--mt);font-weight:700;">SESSIONS</div>
                <div style="font-family:'Bangers',cursive;font-size:18px;color:var(--bl);">${totalSessions}</div>
            </div>
            <div style="text-align:center;background:var(--cd2);border-radius:8px;padding:6px;">
                <div style="font-size:9px;color:var(--mt);font-weight:700;">AVG VOL</div>
                <div style="font-family:'Bangers',cursive;font-size:18px;color:var(--or);">${avgVol}kg</div>
            </div>
            <div style="text-align:center;background:var(--cd2);border-radius:8px;padding:6px;">
                <div style="font-size:9px;color:var(--mt);font-weight:700;">COVERAGE</div>
                <div style="font-family:'Bangers',cursive;font-size:18px;color:var(--gn);">${Math.round(meta.muscleBalance*100)}%</div>
            </div>
        </div>
        <div style="font-size:10px;color:var(--mt);font-weight:700;margin-bottom:4px;">GOAL PROGRESS — ${progressPct}%</div>
        <div class="prog-bar"><div class="prog-fill" style="width:${progressPct}%;background:var(--pu);"></div></div>
        <div style="font-size:11px;color:var(--mt);margin-top:8px;">
            📊 ML momentum score: <span style="color:var(--pu);font-weight:800;">${Math.round(fc*100)}/100</span>
            ${totalSessions >= 5 ? `· <span style="color:var(--gn);">Trained on your real data ✓</span>` : `· <span style="color:var(--mt);">Log ${5-totalSessions} more sessions to fully personalise</span>`}
        </div>`;

    drawChart(pred, state, curLvl);
}