import { trainModel, getMLPrediction, renderMLInsights, retrainOnNewData } from './ml.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── PASTE YOUR FREE GROQ API KEY HERE ──
const GROQ_API_KEY = 'YOUR_GROQ_API_KEY_HERE';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

const firebaseConfig = {
    apiKey:"",
    authDomain:"fitquest-1b34d.firebaseapp.com",
    projectId:"fitquest-1b34d",
    storageBucket:"fitquest-1b34d.firebasestorage.app",
    messagingSenderId:"23652391821",
    appId:"1:23652391821:web:5555b9799ab69f9b6d7bc4",
    measurementId:"G-P4S9STT5J9"
};
const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const provider    = new GoogleAuthProvider();
const db          = getFirestore(firebaseApp);

const DAYS      = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TODAY_DAY = DAYS[(new Date().getDay()+6)%7];

const CLASSES=[
    {l:0, n:'Novice Warrior', c:'#888'},{l:3, n:'Iron Trainee',   c:'#aaa'},
    {l:7, n:'Bronze Fighter', c:'#CD7F32'},{l:12,n:'Silver Athlete',c:'#C0C0C0'},
    {l:20,n:'Gold Champion',  c:'#FFD700'},{l:30,n:'Platinum Beast',c:'#00FFFF'},
    {l:50,n:'Legendary Titan',c:'#FF6B00'},
];

const PHASES={
    full_body:  {label:'💪 PHASE 1 — FULL BODY',       cls:'full-body',   desc:'Weeks 1-2: Compound movements, all muscle groups each session'},
    upper_lower:{label:'⚡ PHASE 2 — UPPER / LOWER',   cls:'upper-lower', desc:'Weeks 3-4: Alternating upper and lower body focus'},
    ppl:        {label:'🔥 PHASE 3 — PUSH/PULL/LEGS',  cls:'split',       desc:'Weeks 5-6: Push, Pull, Legs split for higher volume'},
    isolation:  {label:'👑 PHASE 4 — ISOLATION FOCUS', cls:'isolation',   desc:'Week 7+: Single and double muscle isolation with progressive overload'},
};

function getVolumeConfig(gymDays){
    const d=gymDays.length;
    if(d<=2)return{exCount:8,sets:'4',note:'2 days/week — high volume per session'};
    if(d===3)return{exCount:6,sets:'4',note:'3 days/week — full body each session'};
    if(d===4)return{exCount:5,sets:'3',note:'4 days/week — upper/lower split'};
    if(d===5)return{exCount:4,sets:'3',note:'5 days/week — push/pull/legs split'};
    if(d===6)return{exCount:4,sets:'3',note:'6 days/week — focused muscle groups'};
    return{exCount:3,sets:'2',note:'7 days/week — daily micro sessions'};
}

const EXERCISE_LIBRARY={
    chest:[{n:'Bench Press',t:'strength'},{n:'Incline DB Press',t:'strength'},{n:'Cable Fly',t:'strength'},{n:'Push-ups',t:'strength'},{n:'Dips',t:'strength'},{n:'Pec Deck',t:'strength'},{n:'Dumbbell Fly',t:'strength'}],
    back:[{n:'Deadlift',t:'strength'},{n:'Barbell Row',t:'strength'},{n:'Pull-ups',t:'strength'},{n:'Cable Row',t:'strength'},{n:'T-Bar Row',t:'strength'},{n:'Chin-ups',t:'strength'},{n:'Lat Pulldown',t:'strength'},{n:'Face Pulls',t:'strength'}],
    legs:[{n:'Barbell Squat',t:'strength'},{n:'Romanian Deadlift',t:'strength'},{n:'Leg Press',t:'strength'},{n:'Leg Curl',t:'strength'},{n:'Leg Extension',t:'strength'},{n:'Calf Raises',t:'strength'},{n:'Hip Thrust',t:'strength'},{n:'Walking Lunges',t:'strength'},{n:'Goblet Squat',t:'strength'}],
    shoulders:[{n:'Overhead Press',t:'strength'},{n:'Lateral Raises',t:'strength'},{n:'Front Raises',t:'strength'},{n:'Rear Delt Fly',t:'strength'},{n:'DB Shoulder Press',t:'strength'}],
    arms:[{n:'Bicep Curls',t:'strength'},{n:'Hammer Curls',t:'strength'},{n:'Tricep Pushdown',t:'strength'},{n:'Skull Crushers',t:'strength'},{n:'Tricep Dips',t:'strength'},{n:'Barbell Curl',t:'strength'}],
    core:[{n:'Plank',t:'core'},{n:'Ab Wheel',t:'core'},{n:'Russian Twists',t:'core'},{n:'Hanging Leg Raise',t:'core'},{n:'Cable Crunch',t:'core'}],
    cardio:[{n:'Treadmill Run',t:'cardio'},{n:'Jump Rope',t:'cardio'},{n:'Rowing Machine',t:'cardio'},{n:'Cycling',t:'cardio'},{n:'HIIT Circuit',t:'cardio'}],
};

function buildSmartSchedule(gymDays,phase,goal,fitnessLevel){
    const vol=getVolumeConfig(gymDays),d=gymDays.length,L=EXERCISE_LIBRARY;
    const setsMap={beginner:'3',intermediate:'4',advanced:'5'};
    const sets=setsMap[fitnessLevel]||vol.sets;
    const repsMap={build_muscle:{strength:'8',core:'12',cardio:'—'},lose_weight:{strength:'15',core:'20',cardio:'—'},endurance:{strength:'20',core:'20',cardio:'—'},general:{strength:'12',core:'15',cardio:'—'}};
    const reps=repsMap[goal]||repsMap.general;
    function fmt(ex){if(ex.t==='cardio')return{...ex,s:'20 min'};if(ex.t==='core')return{...ex,s:`${sets}×${reps.core}`};return{...ex,s:`${sets}×${reps.strength}`};}
    function pick(arr,n,startIdx=0){return arr.slice(startIdx,startIdx+n).map(e=>fmt(e));}
    const schedule={};DAYS.forEach(day=>{schedule[day]=[];});
    const ex=vol.exCount;
    if(d<=3){
        const templates=[[...pick(L.chest,2),...pick(L.back,2),...pick(L.legs,2),...pick(L.shoulders,1),...pick(L.core,1)],[...pick(L.back,2),...pick(L.legs,2),...pick(L.chest,2),...pick(L.arms,1),...pick(L.core,1)],[...pick(L.legs,2),...pick(L.chest,2),...pick(L.back,2),...pick(L.shoulders,1),...pick(L.core,1)]];
        gymDays.forEach((day,i)=>{schedule[day]=templates[i%templates.length].slice(0,ex);});
    }else if(d===4){
        const upper=[...pick(L.chest,2),...pick(L.back,2),...pick(L.shoulders,1)].slice(0,ex);
        const lower=[...pick(L.legs,3),...pick(L.core,1),...pick(L.cardio,1)].slice(0,ex);
        gymDays.forEach((day,i)=>{schedule[day]=i%2===0?upper:lower;});
    }else if(d===5){
        const push=[...pick(L.chest,2),...pick(L.shoulders,1),...pick(L.arms,1,2)].slice(0,ex);
        const pull=[...pick(L.back,2),...pick(L.shoulders,1,2),...pick(L.arms,1)].slice(0,ex);
        const legs=[...pick(L.legs,3),...pick(L.core,1)].slice(0,ex);
        const pats=[push,pull,legs,push,pull];
        gymDays.forEach((day,i)=>{schedule[day]=pats[i%pats.length];});
    }else if(d===6){
        const push=[...pick(L.chest,2),...pick(L.shoulders,1),...pick(L.arms,1,2)].slice(0,ex);
        const pull=[...pick(L.back,2),...pick(L.arms,1),...pick(L.core,1)].slice(0,ex);
        const legs=[...pick(L.legs,3),...pick(L.core,1)].slice(0,ex);
        const push2=[...pick(L.chest,1,2),...pick(L.shoulders,2,1),...pick(L.arms,1,4)].slice(0,ex);
        const pull2=[...pick(L.back,2,2),...pick(L.arms,1,2),...pick(L.core,1)].slice(0,ex);
        const legs2=[...pick(L.legs,2,2),...pick(L.core,1,1),...pick(L.cardio,1)].slice(0,ex);
        const pats=[push,pull,legs,push2,pull2,legs2];
        gymDays.forEach((day,i)=>{schedule[day]=pats[i%pats.length];});
    }else{
        const micro=[[...pick(L.chest,2),...pick(L.core,1)].slice(0,ex),[...pick(L.back,2),...pick(L.core,1)].slice(0,ex),[...pick(L.legs,2),...pick(L.core,1)].slice(0,ex),[...pick(L.shoulders,2),...pick(L.core,1)].slice(0,ex),[...pick(L.arms,2),...pick(L.core,1)].slice(0,ex),[...pick(L.cardio,2),...pick(L.core,1)].slice(0,ex),[...pick(L.legs,1),...pick(L.chest,1),...pick(L.core,1)].slice(0,ex)];
        gymDays.forEach((day,i)=>{schedule[day]=micro[i%micro.length];});
    }
    return schedule;
}

const AVATAR_TIERS=[
    {minLvl:0, name:'Beginner',gear:[],                                                                           aura:'none'},
    {minLvl:3, name:'Trainee', gear:['👟 Shoes'],                                                                 aura:'none'},
    {minLvl:7, name:'Fighter', gear:['👟 Shoes','🧤 Gloves'],                                                     aura:'weak'},
    {minLvl:12,name:'Athlete', gear:['👟 Shoes','🧤 Gloves','🎽 Compression'],                                    aura:'weak'},
    {minLvl:20,name:'Champion',gear:['👟 Shoes','🧤 Gloves','🎽 Compression','🔱 Belt'],                          aura:'medium'},
    {minLvl:30,name:'Beast',   gear:['👟 Shoes','🧤 Gloves','🎽 Compression','🔱 Belt','⚔️ Wraps'],               aura:'strong'},
    {minLvl:50,name:'Legend',  gear:['👟 Shoes','🧤 Gloves','🎽 Compression','🔱 Belt','⚔️ Wraps','👑 Crown'],    aura:'god'},
];

function getBodyStats(lvl){const base=30,gain=Math.min(lvl*3,70);return{STR:Math.round(base+gain*1.0),END:Math.round(base+gain*0.8),AGI:Math.round(base+gain*0.6),VIT:Math.round(base+gain*0.7),PWR:Math.round(base+gain*0.9),DEF:Math.round(base+gain*0.5)};}

// ── State ──
let S={
    name:'Hero',goal:'general',gymDays:[],level:0,
    equip:'full_gym',fitnessLevel:'beginner',
    xp:0,totalXP:0,workoutsDone:0,bestStreak:0,
    currentStreak:0,schedule:{},completedEx:{},weekDone:{},
    mlScore:0,workoutHistory:[],todayLog:[],
    prs:{},          // { 'Bench Press': { weight: 100, date: '2024-01-01', prevWeight: 95 } }
    friendCode:'',   // e.g. 'FQ-X7K2M'
    friends:[],      // array of uids
    friendRequests:[], // incoming requests: [{ uid, name, code }]
};

let currentUser=null;
let obSel={goal:'',level:'',equip:''};
let selDays=[];
let chartInstance=null;
let setRowCount=0;
let ariaChatHistory=[];
let ariaTyping=false;

// ── Generate unique FitQuest code ──
function generateFriendCode(){
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code='FQ-';
    for(let i=0;i<5;i++) code+=chars[Math.floor(Math.random()*chars.length)];
    return code;
}

// ── Firebase Auth ──
window.googleLogin=async()=>{
    try{
        const result=await signInWithPopup(auth,provider);
        currentUser=result.user;
        const ref=doc(db,'users',currentUser.uid);
        const snap=await getDoc(ref);
        if(snap.exists()){
            await loadUserData();
            showScreen('screen-dashboard');
            initDash();
        }else{
            const code=generateFriendCode();
            await setDoc(ref,{
                name:currentUser.displayName||'Hero',email:currentUser.email,
                xp:0,level:0,streak:0,bestStreak:0,totalXP:0,workoutsDone:0,
                friendCode:code,friends:[],friendRequests:[],prs:{},
                createdAt:new Date()
            });
            showScreen('screen-onboard');
        }
    }catch(e){console.error(e);alert(e.message);}
};

async function loadUserData(){
    if(!currentUser)return;
    const snap=await getDoc(doc(db,'users',currentUser.uid));
    if(!snap.exists())return;
    const d=snap.data();
    S.name=d.name||'Hero';S.goal=d.goal||'general';S.gymDays=d.gymDays||['Mon','Wed','Fri'];
    S.equip=d.equip||'full_gym';S.fitnessLevel=d.fitnessLevel||'beginner';S.schedule=d.schedule||{};
    S.xp=d.xp||0;S.totalXP=d.totalXP||0;S.level=d.level||0;S.currentStreak=d.streak||0;
    S.bestStreak=d.bestStreak||0;S.workoutsDone=d.workoutsDone||0;S.completedEx=d.completedEx||{};
    S.weekDone=d.weekDone||{};S.workoutHistory=d.workoutHistory||[];
    S.prs=d.prs||{};
    S.friendCode=d.friendCode||generateFriendCode();
    S.friends=d.friends||[];
    S.friendRequests=d.friendRequests||[];
    // Ensure friendCode saved if missing
    if(!d.friendCode){
        await setDoc(doc(db,'users',currentUser.uid),{friendCode:S.friendCode},{merge:true});
    }
}

async function saveUserData(){
    if(!currentUser)return;
    try{
        await setDoc(doc(db,'users',currentUser.uid),{
            name:S.name,goal:S.goal,gymDays:S.gymDays,equip:S.equip,fitnessLevel:S.fitnessLevel,
            schedule:S.schedule,xp:S.xp,totalXP:S.totalXP,level:S.level,streak:S.currentStreak,
            bestStreak:S.bestStreak,workoutsDone:S.workoutsDone,completedEx:S.completedEx,
            weekDone:S.weekDone,workoutHistory:S.workoutHistory,prs:S.prs,
            friendCode:S.friendCode,friends:S.friends,friendRequests:S.friendRequests,
            lastSaved:new Date()
        },{merge:true});
    }catch(e){console.error('Save failed:',e);}
}

function showScreen(id){
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
window.showScreen=showScreen;

window.nextOb=n=>{document.querySelectorAll('.ob-step').forEach(s=>s.classList.remove('active'));document.getElementById('ob'+n).classList.add('active');};
window.selOpt=(btn,key,val)=>{btn.closest('div').querySelectorAll('.opt-btn').forEach(b=>b.classList.remove('sel'));btn.classList.add('sel');obSel[key]=val;};
window.toggleDay=(btn,day)=>{btn.classList.toggle('sel');selDays.includes(day)?selDays=selDays.filter(d=>d!==day):selDays.push(day);};

window.startApp=async()=>{
    S.name=document.getElementById('heroName').value.trim()||currentUser?.displayName||'Hero';
    S.goal=obSel.goal||'general';
    S.gymDays=selDays.length>=2?[...selDays]:['Mon','Wed','Fri'];
    S.equip=obSel.equip||'full_gym';
    S.fitnessLevel=obSel.level||'beginner';
    if(!S.friendCode)S.friendCode=generateFriendCode();
    S.schedule=buildSmartSchedule(S.gymDays,getCurrentPhase(),S.goal,S.fitnessLevel);
    await saveUserData();
    showScreen('screen-dashboard');
    initDash();
    await trainModel(onMLStatus,S);
};

function getCurrentPhase(){const w=S.workoutsDone;if(w<8)return 'full_body';if(w<16)return 'upper_lower';if(w<28)return 'ppl';return 'isolation';}

function rebuildScheduleIfNeeded(){
    const hasEx=Object.values(S.schedule).some(exs=>exs&&exs.length>0);
    if(!hasEx)S.schedule=buildSmartSchedule(S.gymDays,getCurrentPhase(),S.goal,S.fitnessLevel);
}

function initDash(){
    const badge=document.getElementById('userBadge');
    if(badge)badge.textContent=currentUser?.displayName||S.name;
    rebuildScheduleIfNeeded();
    updateAvatar();
    renderSched();
    renderToday();
    renderWeekStreak();
    renderAch();
    updateStats();
    renderPhaseBanner();
    renderTodayLog();
    renderPRs();
    renderFriendCode();
    renderFriendRequests();
    loadFriendsLeaderboard();
    trainModel(onMLStatus,S);
}
window.initDash=initDash;

function onMLStatus(status){
    const el=document.getElementById('mlStatus');if(!el)return;
    el.textContent=status;
    el.style.color=status==='ML READY'?'var(--gn)':status==='TRAINING LOCAL...'?'var(--or)':'var(--bl)';
    if(status==='ML READY')setTimeout(()=>updateMLPanel(),300);
}

// ── PERSONAL RECORDS ─────────────────────────────────────────

function checkForPR(exerciseName, weight){
    if(!weight||weight<=0)return false;
    const existing=S.prs[exerciseName];
    if(!existing||weight>existing.weight){
        const prev=existing?existing.weight:null;
        S.prs[exerciseName]={
            weight,
            date:new Date().toISOString().split('T')[0],
            prevWeight:prev,
        };
        return{exercise:exerciseName,weight,prevWeight:prev};
    }
    return false;
}

function showPRModal(prData){
    document.getElementById('prModalExercise').textContent=prData.exercise;
    document.getElementById('prModalWeight').textContent=prData.weight+'kg';
    document.getElementById('prModalSub').textContent=prData.prevWeight
        ?`+${(prData.weight-prData.prevWeight).toFixed(1)}kg from previous best of ${prData.prevWeight}kg`
        :'First time logging this exercise — new PR!';
    spawnConfetti();
    document.getElementById('prModal').classList.add('open');
    gainXP(30); // bonus XP for PR
}
window.closePRModal=()=>document.getElementById('prModal').classList.remove('open');

function spawnConfetti(){
    const container=document.getElementById('prConfetti');
    container.innerHTML='';
    const colors=['#FF6B00','#FFD700','#44FF88','#AA44FF','#FF3366','#4488FF'];
    for(let i=0;i<28;i++){
        const piece=document.createElement('div');
        piece.className='confetti-piece';
        piece.style.cssText=`
            left:${Math.random()*100}%;
            background:${colors[Math.floor(Math.random()*colors.length)]};
            animation-duration:${0.8+Math.random()*1}s;
            animation-delay:${Math.random()*0.4}s;
            transform:rotate(${Math.random()*360}deg);
            width:${6+Math.random()*6}px;
            height:${6+Math.random()*6}px;
        `;
        container.appendChild(piece);
    }
}

function renderPRs(){
    const prs=S.prs||{};
    const entries=Object.entries(prs).sort((a,b)=>new Date(b[1].date)-new Date(a[1].date));
    const totalPRs=entries.length;
    const latestPR=entries[0];
    const topWeight=entries.reduce((m,[,v])=>v.weight>m?v.weight:m,0);

    // Summary row
    const summaryEl=document.getElementById('prSummaryRow');
    if(summaryEl){
        summaryEl.innerHTML=`
            <div class="pr-summary-card"><div class="pr-summary-val">${totalPRs}</div><div class="pr-summary-lbl">Total PRs</div></div>
            <div class="pr-summary-card"><div class="pr-summary-val">${topWeight?topWeight+'kg':'—'}</div><div class="pr-summary-lbl">Top Lift</div></div>
            <div class="pr-summary-card"><div class="pr-summary-val">${latestPR?latestPR[0].split(' ')[0]:'—'}</div><div class="pr-summary-lbl">Latest PR</div></div>
        `;
    }

    // PR grid
    const grid=document.getElementById('prGrid');
    if(!grid)return;
    if(!entries.length){
        grid.innerHTML='<div style="color:var(--mt);font-size:12px;padding:1rem 0;text-align:center;grid-column:1/-1;">Log workouts to start tracking your PRs automatically! 💪</div>';
        return;
    }
    grid.innerHTML=entries.map(([name,pr])=>{
        const isNew=(new Date()-new Date(pr.date))<86400000*3;
        const improvement=pr.prevWeight?`+${(pr.weight-pr.prevWeight).toFixed(1)}kg from ${pr.prevWeight}kg`:'First PR!';
        return `<div class="pr-card ${isNew?'new-pr':''}">
            <div class="pr-card-badge">${isNew?'🆕':'🏆'}</div>
            <div class="pr-card-exercise">${name}</div>
            <div><span class="pr-card-weight">${pr.weight}</span><span class="pr-card-unit">kg</span></div>
            <div class="pr-card-prev">${improvement}</div>
            <div class="pr-card-date">${pr.date}</div>
        </div>`;
    }).join('');

    // Update stat
    const stPR=document.getElementById('stPR');
    if(stPR)stPR.textContent=totalPRs;
}

// ── FRIENDS SYSTEM ─────────────────────────────────────────────

function renderFriendCode(){
    const el=document.getElementById('myFriendCode');
    if(el)el.textContent=S.friendCode||'Loading...';
}

window.copyFriendCode=()=>{
    if(!S.friendCode)return;
    navigator.clipboard.writeText(S.friendCode).then(()=>{
        const btn=document.querySelector('.friend-copy-btn');
        if(btn){btn.textContent='✅ Copied!';setTimeout(()=>btn.textContent='📋 Copy Code',2000);}
    });
};

window.sendFriendRequest=async()=>{
    const input=document.getElementById('friendCodeInput');
    const code=input?.value?.trim()?.toUpperCase();
    const statusEl=document.getElementById('friendRequestStatus');
    if(!code||!code.startsWith('FQ-')){
        if(statusEl){statusEl.textContent='❌ Enter a valid FitQuest code (e.g. FQ-X7K2M)';statusEl.style.color='var(--rd)';}
        return;
    }
    if(code===S.friendCode){
        if(statusEl){statusEl.textContent='❌ That\'s your own code!';statusEl.style.color='var(--rd)';}
        return;
    }
    try{
        // Find user with this code
        const usersRef=collection(db,'users');
        const q=query(usersRef,where('friendCode','==',code));
        const snap=await getDocs(q);
        if(snap.empty){
            if(statusEl){statusEl.textContent='❌ No user found with that code';statusEl.style.color='var(--rd)';}
            return;
        }
        const targetDoc=snap.docs[0];
        const targetUid=targetDoc.id;
        const targetData=targetDoc.data();

        // Already friends?
        if(S.friends.includes(targetUid)){
            if(statusEl){statusEl.textContent='✅ Already friends!';statusEl.style.color='var(--gn)';}
            return;
        }

        // Send request — add to their friendRequests array
        await updateDoc(doc(db,'users',targetUid),{
            friendRequests:arrayUnion({uid:currentUser.uid,name:S.name,code:S.friendCode})
        });

        if(statusEl){statusEl.textContent=`✅ Friend request sent to ${targetData.name}!`;statusEl.style.color='var(--gn)';}
        if(input)input.value='';
    }catch(e){
        console.error(e);
        if(statusEl){statusEl.textContent='❌ Error sending request. Try again.';statusEl.style.color='var(--rd)';}
    }
};

function renderFriendRequests(){
    const requests=S.friendRequests||[];
    const section=document.getElementById('friendRequestsSection');
    const list=document.getElementById('friendRequestsList');
    if(!section||!list)return;
    if(!requests.length){section.style.display='none';return;}
    section.style.display='block';
    list.innerHTML=requests.map(r=>`
        <div class="friend-request-card">
            <div><div class="friend-request-name">${r.name}</div><div class="friend-request-code">${r.code}</div></div>
            <div>
                <button class="friend-req-btn friend-req-accept" onclick="acceptFriendRequest('${r.uid}','${r.name}','${r.code}')">✓ Accept</button>
                <button class="friend-req-btn friend-req-decline" onclick="declineFriendRequest('${r.uid}')">✕</button>
            </div>
        </div>
    `).join('');
}

window.acceptFriendRequest=async(uid,name,code)=>{
    try{
        // Add to both friends lists
        S.friends.push(uid);
        S.friendRequests=S.friendRequests.filter(r=>r.uid!==uid);
        // Update current user
        await updateDoc(doc(db,'users',currentUser.uid),{
            friends:arrayUnion(uid),
            friendRequests:arrayRemove({uid,name,code})
        });
        // Add self to their friends list
        await updateDoc(doc(db,'users',uid),{
            friends:arrayUnion(currentUser.uid)
        });
        renderFriendRequests();
        loadFriendsLeaderboard();
        alert(`✅ You and ${name} are now friends!`);
    }catch(e){console.error(e);}
};

window.declineFriendRequest=async(uid)=>{
    try{
        const req=S.friendRequests.find(r=>r.uid===uid);
        S.friendRequests=S.friendRequests.filter(r=>r.uid!==uid);
        if(req)await updateDoc(doc(db,'users',currentUser.uid),{friendRequests:arrayRemove(req)});
        renderFriendRequests();
    }catch(e){console.error(e);}
};

async function loadFriendsLeaderboard(){
    const container=document.getElementById('friendsLeaderboard');
    if(!container)return;
    if(!S.friends||!S.friends.length){
        container.innerHTML='<div style="color:var(--mt);font-size:12px;padding:1rem 0;text-align:center;">Add friends to see the leaderboard! 👥</div>';
        return;
    }
    try{
        // Fetch all friends' data
        const friendDocs=await Promise.all(S.friends.map(uid=>getDoc(doc(db,'users',uid))));
        const friendsData=friendDocs
            .filter(d=>d.exists())
            .map(d=>({uid:d.id,...d.data()}));

        // Add self
        const allPlayers=[
            {uid:currentUser.uid,name:S.name,level:S.level,currentStreak:S.currentStreak,prs:S.prs||{},isSelf:true,friendCode:S.friendCode},
            ...friendsData.map(f=>({...f,isSelf:false}))
        ];

        // Sort by level desc
        allPlayers.sort((a,b)=>(b.level||0)-(a.level||0));

        container.innerHTML=allPlayers.map((p,i)=>{
            const cls=getCharCls(p.level||0);
            const topPR=Object.entries(p.prs||{}).sort((a,b)=>b[1].weight-a[1].weight)[0];
            const topPRStr=topPR?`${topPR[0].split(' ')[0]}: ${topPR[1].weight}kg`:'No PRs yet';
            const miniAvatar=buildAvatarSVG(p.level||0,getAvatarTier(p.level||0));
            const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
            return `<div class="friend-lb-card">
                <div class="friend-lb-rank">${medal||'#'+(i+1)}</div>
                <div class="friend-lb-avatar-mini">${miniAvatar}</div>
                <div class="friend-lb-info">
                    <div class="friend-lb-name">${p.name||'Hero'} ${p.isSelf?'<span class="friend-you-badge">YOU</span>':''}</div>
                    <div class="friend-lb-class" style="color:${cls.c}">${cls.n}</div>
                </div>
                <div class="friend-lb-stats">
                    <div class="friend-lb-stat">
                        <div class="friend-lb-stat-val">LV${p.level||0}</div>
                        <div class="friend-lb-stat-lbl">Level</div>
                    </div>
                    <div class="friend-lb-stat">
                        <div class="friend-lb-stat-val">🔥${p.currentStreak||0}</div>
                        <div class="friend-lb-stat-lbl">Streak</div>
                    </div>
                    <div class="friend-lb-stat" style="max-width:80px;">
                        <div class="friend-lb-stat-val" style="font-size:10px;color:var(--gd);">🏆</div>
                        <div class="friend-lb-stat-lbl">${topPRStr}</div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }catch(e){
        console.error('Leaderboard error:',e);
        container.innerHTML='<div style="color:var(--mt);font-size:12px;padding:.5rem 0;">Could not load leaderboard.</div>';
    }
}

// ── ARIA ─────────────────────────────────────────────────────

function buildAriaSystemPrompt(){
    const history=S.workoutHistory||[];
    const todayDate=new Date().toISOString().split('T')[0];
    const exerciseSummary={};
    history.forEach(session=>{(session.exercises||[]).forEach(ex=>{if(!exerciseSummary[ex.name])exerciseSummary[ex.name]=[];exerciseSummary[ex.name].push({date:session.date,maxWeight:ex.maxWeight||0,volume:ex.volume||0});});});
    const exLines=Object.entries(exerciseSummary).slice(0,15).map(([name,sessions])=>{const last=sessions[sessions.length-1];const prev=sessions[sessions.length-2];const trend=prev&&last.maxWeight>prev.maxWeight?'↑':prev&&last.maxWeight<prev.maxWeight?'↓':'→';return `  - ${name}: ${sessions.length} sessions, last max ${last.maxWeight}kg ${trend}`;}).join('\n');
    const prLines=Object.entries(S.prs||{}).slice(0,10).map(([name,pr])=>`  - ${name}: ${pr.weight}kg (${pr.date})`).join('\n');
    const todaySchedule=(S.schedule[TODAY_DAY]||[]).map(e=>`${e.n} (${e.s})`).join(', ')||'Rest day';
    return `You are ARIA (Adaptive Recovery & Intelligence Assistant), the personal AI fitness coach inside FitQuest. NEVER mention Groq, Llama, or any AI company. You are ARIA, built by FitQuest.
USER: ${S.name} | Goal: ${S.goal.replace('_',' ')} | Level: ${S.level} (${getCharCls(S.level).n}) | Streak: ${S.currentStreak} days | Workouts: ${S.workoutsDone}
GYM DAYS: ${S.gymDays.length} days/week (${S.gymDays.join(', ')}) | Fitness: ${S.fitnessLevel} | Equipment: ${S.equip.replace('_',' ')}
TODAY (${todayDate} — ${TODAY_DAY}): ${todaySchedule}
WORKOUT HISTORY (${history.length} sessions):\n${exLines||'  None yet'}
PERSONAL RECORDS:\n${prLines||'  None yet'}
RULES: Be specific and data-driven. Reference real numbers. If suggesting schedule changes, end message with SCHEDULE_UPDATE:{...json...} with all 7 days. Keep responses to 3-5 sentences unless full plan requested. Be motivational. Reference their FitQuest level for motivation.`;
}

function ariaInit(){
    const box=document.getElementById('ariaChatBox');if(!box)return;
    ariaChatHistory=[];box.innerHTML='';
    setTimeout(()=>{addAriaMessage('aria',`Hey ${S.name}! ⚡ I'm ARIA, your personal fitness coach. ${Object.keys(S.prs||{}).length>0?`I can see you've set ${Object.keys(S.prs).length} personal records — let's break more! `:''}What do you need today?`);},400);
}

function addAriaMessage(role,text,scheduleData=null){
    const box=document.getElementById('ariaChatBox');if(!box)return;
    const wrap=document.createElement('div');wrap.className=`aria-msg ${role}`;
    const icon=document.createElement('div');icon.className='aria-bubble-icon';icon.textContent=role==='aria'?'⚡':'🧑';
    const bubble=document.createElement('div');bubble.className='aria-bubble';bubble.innerHTML=text.replace(/\n/g,'<br/>');
    if(scheduleData){const btn=document.createElement('button');btn.className='aria-apply-btn';btn.textContent='✅ Apply This Plan to My Schedule';btn.onclick=()=>applyAriaSchedule(scheduleData,btn);bubble.appendChild(document.createElement('br'));bubble.appendChild(btn);}
    wrap.appendChild(icon);wrap.appendChild(bubble);box.appendChild(wrap);box.scrollTop=box.scrollHeight;
}

function addAriaTyping(){
    const box=document.getElementById('ariaChatBox');if(!box)return;
    const wrap=document.createElement('div');wrap.className='aria-msg aria';wrap.id='ariaTypingIndicator';
    const icon=document.createElement('div');icon.className='aria-bubble-icon';icon.textContent='⚡';
    const typing=document.createElement('div');typing.className='aria-typing';typing.innerHTML='<span></span><span></span><span></span>';
    wrap.appendChild(icon);wrap.appendChild(typing);box.appendChild(wrap);box.scrollTop=box.scrollHeight;
}
function removeAriaTyping(){const el=document.getElementById('ariaTypingIndicator');if(el)el.remove();}

async function sendAriaMessage(){
    if(ariaTyping)return;
    const input=document.getElementById('ariaInput');
    const text=input?.value?.trim();if(!text)return;
    input.value='';
    const chips=document.getElementById('ariaSuggestions');if(chips)chips.style.display='none';
    addAriaMessage('user',text);
    ariaChatHistory.push({role:'user',content:text});
    ariaTyping=true;addAriaTyping();
    try{
        const messages=[{role:'system',content:buildAriaSystemPrompt()},...ariaChatHistory.slice(-10)];
        const res=await fetch(GROQ_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model:GROQ_MODEL,messages,max_tokens:600,temperature:0.72})});
        if(!res.ok){const err=await res.json();throw new Error(err.error?.message||'API error');}
        const data=await res.json();
        let reply=data.choices?.[0]?.message?.content||'Sorry, try again!';
        let scheduleData=null;
        const schedMatch=reply.match(/SCHEDULE_UPDATE:(\{[\s\S]*?\})\s*$/m);
        if(schedMatch){try{scheduleData=JSON.parse(schedMatch[1]);reply=reply.replace(/SCHEDULE_UPDATE:[\s\S]*$/m,'').trim();}catch(e){}}
        removeAriaTyping();addAriaMessage('aria',reply,scheduleData);
        ariaChatHistory.push({role:'assistant',content:reply});
    }catch(err){
        removeAriaTyping();
        addAriaMessage('aria',err.message.includes('API key')||err.message.includes('auth')?'⚠️ Add your free Groq key in app.js to activate ARIA.':'Sorry, connection issue. Try again.');
    }
    ariaTyping=false;
}
window.sendAriaMessage=sendAriaMessage;
window.ariaQuickAsk=(chip)=>{const input=document.getElementById('ariaInput');if(input)input.value=chip.textContent;sendAriaMessage();};

function applyAriaSchedule(scheduleData,btn){
    try{DAYS.forEach(day=>{if(Array.isArray(scheduleData[day]))S.schedule[day]=scheduleData[day];});saveUserData();renderSched();renderToday();btn.textContent='✅ Plan Applied!';btn.style.background='var(--gn)';btn.disabled=true;setTimeout(()=>{addAriaMessage('aria',`Schedule updated! 💪 Check the SCHEDULE tab. Let's go, ${S.name}!`);},300);}
    catch(e){btn.textContent='❌ Failed';}
}

// ── AVATAR ───────────────────────────────────────────────────

function getAvatarTier(lvl){let t=AVATAR_TIERS[0];for(const x of AVATAR_TIERS)if(lvl>=x.minLvl)t=x;return t;}
function getCharCls(l){let c=CLASSES[0];for(const x of CLASSES)if(l>=x.l)c=x;return c;}
function xpNeeded(l){return 100+l*50;}

function buildAvatarSVG(l,tier){
    const m=Math.min(1+l*0.018,1.7);
    const sk='#D4906A',skM='#B87050',skD='#9A5535';
    const hair=l<15?'#3a2010':l<35?'#1a0800':'#000';
    const short=l<10?'#CC2222':l<25?'#AA1111':l<40?'#880000':'#440000';
    const top=l<3?'#4a5568':l<7?'#CC4400':l<15?'#1a1a3a':l<25?'#330066':'#110033';
    const eyeC=l>=50?'#FFD700':l>=25?'#AA33FF':'#1a0808';
    const bw=Math.round(38*m),bx=Math.round((100-bw)/2),aw=Math.round(13*m),lw=Math.round(14*m);
    const th=Math.round(30*m),lh=Math.round(36*m),bodyY=58,legY=bodyY+th,footY=legY+lh;
    const hR=20,hCX=50,hCY=32,eyeOX=Math.round(hR*0.36),eyeR=Math.round(hR*0.18),H=footY+24;
    const hasBelt=l>=12,hasGloves=l>=7,hasWraps=l>=25,hasCrown=l>=50,hasShoes=l>=3,hasShirt=l<7;
    const muscleDef=l>=7?`<path d="M${bx+Math.round(bw*.28)} ${bodyY+4} L${bx+Math.round(bw*.28)} ${bodyY+Math.round(th*.7)}" stroke="rgba(0,0,0,.2)" stroke-width="${Math.min(l/7,2.5)}" stroke-linecap="round"/><path d="M${bx+Math.round(bw*.72)} ${bodyY+4} L${bx+Math.round(bw*.72)} ${bodyY+Math.round(th*.7)}" stroke="rgba(0,0,0,.2)" stroke-width="${Math.min(l/7,2.5)}" stroke-linecap="round"/>`:'';
    const pecs=l>=12?`<ellipse cx="${bx+Math.round(bw*.27)}" cy="${bodyY+Math.round(th*.2)}" rx="${Math.round(bw*.13)}" ry="${Math.round(th*.13)}" fill="rgba(255,255,255,.07)"/><ellipse cx="${bx+Math.round(bw*.73)}" cy="${bodyY+Math.round(th*.2)}" rx="${Math.round(bw*.13)}" ry="${Math.round(th*.13)}" fill="rgba(255,255,255,.07)"/>`:'';
    const absSVG=(()=>{if(l<3)return '';const rows=l<7?1:l<15?2:3;let s=`<path d="M${hCX} ${bodyY+Math.round(th*.06)} L${hCX} ${legY}" stroke="${skD}" stroke-width="${Math.round(m)}" opacity=".4"/>`;for(let r=0;r<rows;r++){const ay=bodyY+Math.round(th*.42)+Math.round(r*9*m);s+=`<ellipse cx="${hCX-Math.round(bw*.2)}" cy="${ay}" rx="${Math.round(bw*.19)}" ry="${Math.round(3.5*m)}" fill="${skM}" opacity=".6"/><ellipse cx="${hCX+Math.round(bw*.2)}" cy="${ay}" rx="${Math.round(bw*.19)}" ry="${Math.round(3.5*m)}" fill="${skM}" opacity=".6"/>`;}return s;})();
    const hairSVG=l<15?`<ellipse cx="${hCX}" cy="${hCY-hR*.38}" rx="${hR*.95}" ry="${hR*.58}" fill="${hair}"/><rect x="${hCX-hR*.88}" y="${hCY-hR*.52}" width="${Math.round(hR*.3)}" height="${Math.round(hR*.7)}" rx="3" fill="${hair}"/><rect x="${hCX+hR*.58}" y="${hCY-hR*.52}" width="${Math.round(hR*.3)}" height="${Math.round(hR*.7)}" rx="3" fill="${hair}"/>`:l<35?`<ellipse cx="${hCX}" cy="${hCY-hR*.35}" rx="${hR*1.02}" ry="${hR*.55}" fill="${hair}"/><path d="M${hCX-hR*.92} ${hCY-hR*.08} Q${hCX-hR*.72} ${hCY+hR*.42} ${hCX-hR*.52} ${hCY+hR*.5}" fill="${hair}"/>`:`<ellipse cx="${hCX}" cy="${hCY-hR*.38}" rx="${hR*1.06}" ry="${hR*.6}" fill="${hair}"/><path d="M${hCX-hR} ${hCY-hR*.06} Q${hCX-hR*1.15} ${hCY+hR*.32} ${hCX-hR*.55} ${hCY+hR*.55}" fill="${hair}"/><path d="M${hCX+hR} ${hCY-hR*.06} Q${hCX+hR*1.15} ${hCY+hR*.32} ${hCX+hR*.55} ${hCY+hR*.55}" fill="${hair}"/>`;
    const eyeGlow=l>=25?`<ellipse cx="${hCX-eyeOX}" cy="${hCY+2}" rx="${eyeR+3}" ry="${eyeR+3}" fill="${eyeC}" opacity=".2"/><ellipse cx="${hCX+eyeOX}" cy="${hCY+2}" rx="${eyeR+3}" ry="${eyeR+3}" fill="${eyeC}" opacity=".2"/>`:'';
    const scar=l>=12?`<path d="M${hCX+eyeOX-1} ${hCY-eyeR*2} L${hCX+eyeOX+4} ${hCY+eyeR*3}" stroke="#cc4444" stroke-width="1.3" stroke-linecap="round" opacity=".75"/>`:'';
    const crownSVG=hasCrown?`<polygon points="${hCX},${hCY-hR*1.55} ${hCX-7},${hCY-hR*1.25} ${hCX+7},${hCY-hR*1.25}" fill="#FFD700"/><polygon points="${hCX-10},${hCY-hR*1.45} ${hCX-17},${hCY-hR*1.15} ${hCX-3},${hCY-hR*1.15}" fill="#FFD700"/><polygon points="${hCX+10},${hCY-hR*1.45} ${hCX+17},${hCY-hR*1.15} ${hCX+3},${hCY-hR*1.15}" fill="#FFD700"/>`:'';
    const flameSVG=l>=30?`<path d="M${bx-8} ${legY} Q${bx-14} ${legY-18} ${bx-4} ${legY-30} Q${bx-10} ${legY-14} ${bx} ${legY}" fill="rgba(255,107,0,.4)"/><path d="M${bx+bw+8} ${legY} Q${bx+bw+14} ${legY-18} ${bx+bw+4} ${legY-30} Q${bx+bw+10} ${legY-14} ${bx+bw} ${legY}" fill="rgba(255,107,0,.4)"/>`:'';
    const beltSVG=hasBelt?`<rect x="${bx}" y="${bodyY+Math.round(th*.68)}" width="${bw}" height="${Math.round(th*.15)}" rx="3" fill="#FFD700" opacity=".92"/>`:'';
    const wrapSVG=hasWraps?`<rect x="${bx-Math.round(aw*1.06)}" y="${bodyY+Math.round(th*.55)}" width="${aw}" height="${Math.round(th*.22)}" rx="3" fill="#CC8800" opacity=".85"/><rect x="${bx+bw+Math.round(aw*.06)}" y="${bodyY+Math.round(th*.55)}" width="${aw}" height="${Math.round(th*.22)}" rx="3" fill="#CC8800" opacity=".85"/>`:'';
    const gloveSVG=hasGloves?`<ellipse cx="${bx-Math.round(aw*.55)}" cy="${bodyY+Math.round(th*.84)}" rx="${Math.round(aw*.55)}" ry="${Math.round(th*.12)}" fill="#111"/><ellipse cx="${bx+bw+Math.round(aw*.55)}" cy="${bodyY+Math.round(th*.84)}" rx="${Math.round(aw*.55)}" ry="${Math.round(th*.12)}" fill="#111"/>`:'';
    const shoeSVG=hasShoes?`<ellipse cx="${bx+Math.round(lw*.45)}" cy="${footY+7}" rx="${Math.round(lw*.82)}" ry="6" fill="#e8e8e8"/><ellipse cx="${bx+bw-Math.round(lw*.45)}" cy="${footY+7}" rx="${Math.round(lw*.82)}" ry="6" fill="#e8e8e8"/>`:`<ellipse cx="${bx+Math.round(lw*.45)}" cy="${footY+7}" rx="${Math.round(lw*.7)}" ry="5" fill="#333"/><ellipse cx="${bx+bw-Math.round(lw*.45)}" cy="${footY+7}" rx="${Math.round(lw*.7)}" ry="5" fill="#333"/>`;
    return `<svg viewBox="0 0 100 ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
        <ellipse cx="${hCX}" cy="${footY+14}" rx="${Math.round(bw*.72)}" ry="5.5" fill="rgba(0,0,0,.38)"/>
        ${flameSVG}
        <rect x="${bx}" y="${legY}" width="${Math.round(lw*.84)}" height="${lh}" rx="${Math.round(lw*.36)}" fill="${short}"/>
        <rect x="${bx+bw-Math.round(lw*.84)}" y="${legY}" width="${Math.round(lw*.84)}" height="${lh}" rx="${Math.round(lw*.36)}" fill="${short}"/>
        ${shoeSVG}
        <rect x="${bx-Math.round(aw*1.06)}" y="${bodyY}" width="${aw}" height="${Math.round(th*.9)}" rx="${Math.round(aw*.36)}" fill="${hasShirt?top:skM}"/>
        <rect x="${bx+bw+Math.round(aw*.06)}" y="${bodyY}" width="${aw}" height="${Math.round(th*.9)}" rx="${Math.round(aw*.36)}" fill="${hasShirt?top:skM}"/>
        ${wrapSVG}${gloveSVG}
        <rect x="${bx}" y="${bodyY}" width="${bw}" height="${th}" rx="${Math.round(bw*.15)}" fill="${hasShirt?top:sk}"/>
        ${pecs}${muscleDef}${absSVG}${beltSVG}
        <rect x="${Math.round(hCX-bw*.12)}" y="${bodyY-12}" width="${Math.round(bw*.24)}" height="15" rx="5" fill="${sk}"/>
        <ellipse cx="${hCX}" cy="${hCY+hR*.06}" rx="${hR}" ry="${hR*1.06}" fill="${sk}"/>
        ${hairSVG}${crownSVG}${eyeGlow}
        <ellipse cx="${hCX-eyeOX}" cy="${hCY+2}" rx="${eyeR}" ry="${eyeR*1.1}" fill="${eyeC}"/>
        <ellipse cx="${hCX+eyeOX}" cy="${hCY+2}" rx="${eyeR}" ry="${eyeR*1.1}" fill="${eyeC}"/>
        <ellipse cx="${hCX-eyeOX}" cy="${hCY+2}" rx="${eyeR*.6}" ry="${eyeR*.7}" fill="${l>=25?eyeC:'#0a0408'}"/>
        <ellipse cx="${hCX+eyeOX}" cy="${hCY+2}" rx="${eyeR*.6}" ry="${eyeR*.7}" fill="${l>=25?eyeC:'#0a0408'}"/>
        <circle cx="${hCX-eyeOX+eyeR*.35}" cy="${hCY+2-eyeR*.35}" r="${eyeR*.32}" fill="rgba(255,255,255,.92)"/>
        <circle cx="${hCX+eyeOX+eyeR*.35}" cy="${hCY+2-eyeR*.35}" r="${eyeR*.32}" fill="rgba(255,255,255,.92)"/>
        <path d="M${hCX-eyeOX-eyeR*.7} ${hCY-eyeR*1.7} Q${hCX-eyeOX} ${hCY-eyeR*2.2} ${hCX-eyeOX+eyeR*.7} ${hCY-eyeR*1.7}" stroke="${hair}" stroke-width="${l>=12?2.2:1.8}" fill="none" stroke-linecap="round"/>
        <path d="M${hCX+eyeOX-eyeR*.7} ${hCY-eyeR*1.7} Q${hCX+eyeOX} ${hCY-eyeR*2.2} ${hCX+eyeOX+eyeR*.7} ${hCY-eyeR*1.7}" stroke="${hair}" stroke-width="${l>=12?2.2:1.8}" fill="none" stroke-linecap="round"/>
        ${scar}
        <path d="M${hCX-hR*.15} ${hCY+hR*.45} Q${hCX} ${hCY+hR*.62} ${hCX+hR*.15} ${hCY+hR*.45}" stroke="#D07060" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <ellipse cx="${hCX-hR*.32}" cy="${hCY+hR*.34}" rx="${hR*.13}" ry="${hR*.065}" fill="rgba(220,110,90,.28)"/>
        <ellipse cx="${hCX+hR*.32}" cy="${hCY+hR*.34}" rx="${hR*.13}" ry="${hR*.065}" fill="rgba(220,110,90,.28)"/>
    </svg>`;
}

function renderAura(type){
    const container=document.getElementById('auraContainer');if(!container)return;
    if(type==='none'){container.innerHTML='';return;}
    const configs={weak:[{size:140,color:'rgba(255,107,0,0.2)',speed:6},{size:120,color:'rgba(255,107,0,0.1)',speed:8}],medium:[{size:160,color:'rgba(255,107,0,0.28)',speed:5},{size:135,color:'rgba(255,215,0,0.18)',speed:7},{size:112,color:'rgba(255,107,0,0.12)',speed:9}],strong:[{size:175,color:'rgba(255,107,0,0.35)',speed:4},{size:148,color:'rgba(255,215,0,0.25)',speed:6},{size:124,color:'rgba(170,68,255,0.18)',speed:8}],god:[{size:190,color:'rgba(255,215,0,0.45)',speed:3},{size:162,color:'rgba(255,107,0,0.35)',speed:5},{size:136,color:'rgba(170,68,255,0.25)',speed:7},{size:114,color:'rgba(68,255,136,0.18)',speed:9}]};
    container.innerHTML=(configs[type]||[]).map(r=>`<div class="aura-ring" style="width:${r.size}px;height:${r.size}px;border-color:${r.color};animation-duration:${r.speed}s;"></div>`).join('');
}

function updateAvatar(){
    const l=S.level,tier=getAvatarTier(l),cls=getCharCls(l),pct=Math.min((S.xp/xpNeeded(l))*100,100);
    const safe=(id,fn)=>{const el=document.getElementById(id);if(el)fn(el);};
    const svg=buildAvatarSVG(l,tier);
    // Desktop
    safe('avatarLvl',  el=>el.textContent=l);
    safe('avatarName', el=>el.textContent=S.name.toUpperCase());
    safe('avatarCls',  el=>{el.textContent=cls.n.toUpperCase();el.style.color=cls.c;});
    safe('xpFill',     el=>el.style.width=pct+'%');
    safe('xpTxt',      el=>el.textContent=S.xp+' / '+xpNeeded(l));
    safe('streakCnt',  el=>el.textContent=S.currentStreak);
    safe('avatarSvg',  el=>el.innerHTML=svg);
    // Mobile strip
    safe('mobileAvatarSvg',  el=>el.innerHTML=svg);
    safe('mobileAvatarName', el=>el.textContent=S.name.toUpperCase());
    safe('mobileAvatarCls',  el=>{el.textContent=cls.n.toUpperCase();el.style.color=cls.c;});
    safe('mobileAvatarLvl',  el=>el.textContent=l);
    safe('mobileXpFill',     el=>el.style.width=pct+'%');
    safe('mobileXpTxt',      el=>el.textContent=S.xp+'/'+xpNeeded(l));
    safe('mobileStreakCnt',  el=>el.textContent=S.currentStreak);
    renderAura(tier.aura);
    const stats=getBodyStats(l);
    safe('bodyStats',el=>el.innerHTML=Object.entries(stats).map(([k,v])=>`<div class="body-stat"><div class="body-stat-val">${v}</div><div class="body-stat-lbl">${k}</div></div>`).join(''));
    safe('gearRow',  el=>el.innerHTML=tier.gear.map(g=>`<div class="gear-item unlocked">${g}</div>`).join('')||'<div class="gear-item">No gear yet</div>');
}

function renderPhaseBanner(){
    const phase=getCurrentPhase(),p=PHASES[phase],banner=document.getElementById('phaseBanner');if(!banner)return;
    const vol=getVolumeConfig(S.gymDays);
    banner.className=`phase-banner ${p.cls}`;
    banner.innerHTML=`${p.label}<span style="font-weight:400;font-size:10px;opacity:.8;">${p.desc}</span><span style="font-size:9px;opacity:.65;margin-left:4px;">· ${vol.note}</span>`;
}

function renderToday(){
    const exs=S.schedule[TODAY_DAY]||[],cont=document.getElementById('todayContent');if(!cont)return;
    if(!exs.length){cont.innerHTML='<div style="color:var(--mt);font-size:12px;font-weight:600;text-align:center;padding:.6rem 0;">💤 Rest & Recovery — ARIA-optimized</div>';return;}
    const vol=getVolumeConfig(S.gymDays);
    let dc=0,html=`<div style="font-size:10px;color:var(--mt);font-weight:700;margin-bottom:6px;padding:4px 8px;background:rgba(255,107,0,.06);border-radius:8px;border:1px solid rgba(255,107,0,.15);">📋 ${exs.length} exercises · ${S.gymDays.length} days/week · ${vol.note}</div>`;
    exs.forEach((ex,i)=>{const k=TODAY_DAY+'_'+i,done=!!S.completedEx[k];if(done)dc++;html+=`<div class="ex-row"><div><div class="ex-name">${ex.n}</div><div class="ex-detail">${ex.s}</div></div><div class="ex-check ${done?'done':''}" onclick="toggleEx('${k}',${i})" id="chk_${k}">${done?'✓':''}</div></div>`;});
    const pct=Math.round((dc/exs.length)*100);
    html+=`<div style="margin-top:8px;"><div class="prog-bar-label"><span>PROGRESS</span><span>${dc}/${exs.length}</span></div><div class="prog-bar"><div class="prog-fill" id="todayProg" style="width:${pct}%;background:var(--gn);"></div></div></div>`;
    cont.innerHTML=html;
}

window.toggleEx=(k,i)=>{
    const was=!!S.completedEx[k];S.completedEx[k]=!was;
    const el=document.getElementById('chk_'+k);if(el){el.classList.toggle('done',!was);el.textContent=!was?'✓':'';}
    const exs=S.schedule[TODAY_DAY]||[];let dc=0;
    exs.forEach((_,j)=>{if(S.completedEx[TODAY_DAY+'_'+j])dc++;});
    const pct=Math.round((dc/exs.length)*100);
    const p=document.getElementById('todayProg');if(p)p.style.width=pct+'%';
    if(!was){gainXP(20);if(dc===exs.length)markDayDone();updateMLPanel();}
    else{S.xp=Math.max(0,S.xp-20);S.totalXP=Math.max(0,S.totalXP-20);updateAvatar();updateStats();}
};

window.quickLog=()=>{
    const val=document.getElementById('quickLogInput').value.trim();if(!val)return;
    const m=val.match(/^(.+?)\s+(\d+)[x×](\d+)(?:[x×](\d+(?:\.\d+)?)(?:kg)?)?$/i);
    if(!m){alert('Format: Exercise 3×10×80 or Exercise 3×10');return;}
    addToLog(m[1].trim(),[{sets:parseInt(m[2]),reps:parseInt(m[3]),weight:m[4]?parseFloat(m[4]):0}]);
    document.getElementById('quickLogInput').value='';
};

window.addSet=()=>{
    setRowCount++;const id=`set-${setRowCount}`,div=document.createElement('div');
    div.className='set-row';div.id=id;
    div.innerHTML=`<span class="set-label">SET ${setRowCount}</span><input class="set-input" type="number" min="1" placeholder="Reps" id="${id}-reps"/><input class="set-input" type="number" min="0" step="0.5" placeholder="kg" id="${id}-weight"/><button class="btn-rm-set" onclick="removeSet('${id}')">✕</button>`;
    document.getElementById('setsContainer').appendChild(div);
};
window.removeSet=id=>{const el=document.getElementById(id);if(el)el.remove();};

window.saveDetailLog=()=>{
    const name=document.getElementById('detailExName').value.trim();if(!name){alert('Enter exercise name');return;}
    const sets=[];
    for(let i=1;i<=setRowCount;i++){const re=document.getElementById(`set-${i}-reps`),we=document.getElementById(`set-${i}-weight`);if(!re)continue;const reps=parseInt(re.value||0),weight=parseFloat(we?.value||0);if(reps>0)sets.push({sets:1,reps,weight});}
    if(!sets.length)return;
    addToLog(name,sets);
    document.getElementById('detailExName').value='';document.getElementById('setsContainer').innerHTML='';setRowCount=0;
};

function addToLog(name,sets){
    const today=new Date().toISOString().split('T')[0];
    const totalSets=sets.reduce((a,s)=>a+s.sets,0);
    const totalReps=sets.reduce((a,s)=>a+s.reps*s.sets,0);
    const maxWeight=Math.max(...sets.map(s=>s.weight));
    const volume=sets.reduce((a,s)=>a+s.sets*s.reps*s.weight,0);
    let entry=S.workoutHistory.find(h=>h.date===today);
    if(!entry){entry={date:today,exercises:[]};S.workoutHistory.push(entry);}
    const ex=entry.exercises.find(e=>e.name.toLowerCase()===name.toLowerCase());
    if(ex){ex.sets=totalSets;ex.reps=totalReps;ex.maxWeight=Math.max(ex.maxWeight,maxWeight);ex.volume=volume;}
    else entry.exercises.push({name,sets:totalSets,reps:totalReps,maxWeight,volume});
    S.workoutHistory=S.workoutHistory.slice(-60);
    S.todayLog=entry.exercises;

    // ── Check for PR ──
    if(maxWeight>0){
        const prResult=checkForPR(name,maxWeight);
        if(prResult){
            saveUserData();
            renderPRs();
            setTimeout(()=>showPRModal(prResult),400);
            gainXP(10); // base XP, PR gives extra 30 in showPRModal
            renderTodayLog();
            renderPerformanceCompare(name);
            retrainOnNewData(S).then(()=>{if(document.getElementById('tab-ml')?.classList.contains('active'))updateMLPanel();});
            return;
        }
    }

    gainXP(10);
    renderTodayLog();
    renderPerformanceCompare(name);
    saveUserData();
    retrainOnNewData(S).then(()=>{if(document.getElementById('tab-ml')?.classList.contains('active'))updateMLPanel();});
}

function renderTodayLog(){
    const today=new Date().toISOString().split('T')[0];
    const entry=S.workoutHistory.find(h=>h.date===today);
    const cont=document.getElementById('todayLogDisplay');if(!cont)return;
    if(!entry||!entry.exercises.length){cont.innerHTML='<div style="color:var(--mt);font-size:12px;padding:4px 0;">No exercises logged yet today.</div>';return;}
    cont.innerHTML=entry.exercises.map(e=>{
        const isPR=S.prs[e.name]&&S.prs[e.name].date===today;
        return `<div class="log-entry"><div><div class="log-entry-name">${e.name} ${isPR?'🏆':''}</div><div class="log-entry-detail">${e.sets} sets · ${e.reps} reps${e.maxWeight>0?' · '+e.maxWeight+'kg max':''}</div></div><div style="font-size:10px;color:var(--pu);font-weight:700;">Vol: ${Math.round(e.volume)}kg</div></div>`;
    }).join('');
}

function renderPerformanceCompare(exerciseName){
    const today=new Date().toISOString().split('T')[0];
    const prev=S.workoutHistory.filter(h=>h.date!==today&&h.exercises.some(e=>e.name.toLowerCase()===exerciseName.toLowerCase())).slice(-1);
    if(!prev.length)return;
    const todayEx=S.workoutHistory.find(h=>h.date===today)?.exercises.find(e=>e.name.toLowerCase()===exerciseName.toLowerCase());
    const prevEx=prev[0].exercises.find(e=>e.name.toLowerCase()===exerciseName.toLowerCase());
    if(!todayEx||!prevEx)return;
    const vd=prevEx.volume>0?Math.round(((todayEx.volume-prevEx.volume)/prevEx.volume)*100):0;
    const wd=prevEx.maxWeight>0?Math.round(((todayEx.maxWeight-prevEx.maxWeight)/prevEx.maxWeight)*100):0;
    const vc=vd>0?'perf-up':vd<0?'perf-down':'perf-same';
    const wc=wd>0?'perf-up':wd<0?'perf-down':'perf-same';
    const cont=document.getElementById('perfCompareContent');if(!cont)return;
    cont.innerHTML=`<div style="font-size:11px;color:var(--mt);margin-bottom:6px;font-weight:700;">${exerciseName.toUpperCase()}</div>
        <div class="perf-row"><div><div class="ex-name">Volume</div><div class="ex-detail">Today: ${Math.round(todayEx.volume)}kg · Prev: ${Math.round(prevEx.volume)}kg</div></div><span class="${vc}">${vd>0?'▲':vd<0?'▼':'—'} ${Math.abs(vd)}%</span></div>
        <div class="perf-row"><div><div class="ex-name">Max Weight</div><div class="ex-detail">Today: ${todayEx.maxWeight}kg · Prev: ${prevEx.maxWeight}kg</div></div><span class="${wc}">${wd>0?'▲':wd<0?'▼':'—'} ${Math.abs(wd)}%</span></div>
        <div style="font-size:10px;color:var(--mt);margin-top:6px;">${vd>=5?'🔥 Great progress! Add 2.5kg next session.':vd<0?'⚠️ Volume dropped. Check recovery.':'✅ Consistent. Try 1 more rep per set.'}</div>`;
}

function gainXP(amt){
    S.xp+=amt;S.totalXP+=amt;
    if(S.xp>=xpNeeded(S.level)){S.xp-=xpNeeded(S.level);S.level++;updateAvatar();showLU();}
    else updateAvatar();
    updateStats();
}

function markDayDone(){
    const wk=getWkKey();if(!S.weekDone[wk])S.weekDone[wk]={};
    S.weekDone[wk][TODAY_DAY]=true;S.workoutsDone++;S.currentStreak++;
    if(S.currentStreak>S.bestStreak)S.bestStreak=S.currentStreak;
    const prevPhase=(()=>{const w=S.workoutsDone-1;if(w<8)return 'full_body';if(w<16)return 'upper_lower';if(w<28)return 'ppl';return 'isolation';})();
    const newPhase=getCurrentPhase();
    if(prevPhase!==newPhase){S.schedule=buildSmartSchedule(S.gymDays,newPhase,S.goal,S.fitnessLevel);renderSched();renderToday();}
    gainXP(50);renderWeekStreak();updateStats();renderPhaseBanner();saveUserData();
}

function getWkKey(){const d=new Date(),day=d.getDay(),diff=d.getDate()-day+(day===0?-6:1);return new Date(d.setDate(diff)).toISOString().split('T')[0];}

function renderWeekStreak(){
    const wk=getWkKey(),done=S.weekDone[wk]||{},el=document.getElementById('weekStreak');if(!el)return;
    el.innerHTML=DAYS.map(d=>{const isDone=!!done[d],isToday=d===TODAY_DAY;let cls='streak-dot';if(isDone)cls+=' done-w';else if(isToday)cls+=' today-w';return `<div class="${cls}">${d.charAt(0)}</div>`;}).join('');
}

function renderSched(){
    const tc={cardio:'p-bl',strength:'p-or',core:'p-gn',recovery:'p-mt'};
    const el=document.getElementById('schedWrap');if(!el)return;
    el.innerHTML=DAYS.map(d=>{
        const exs=S.schedule[d]||[],isRest=!exs.length,isToday=d===TODAY_DAY;
        const pills=exs.slice(0,3).map(e=>`<span class="pill ${tc[e.t]||'p-mt'}">${e.n}</span>`).join('');
        const extra=exs.length>3?`<span class="pill p-mt">+${exs.length-3}</span>`:'';
        const dc=isRest?'rest':isToday?'today':'';
        return `<div class="sched-day-block"><div class="sched-day-hdr" onclick="toggleSched('sd_${d}','ar_${d}')"><span class="sched-day-name ${dc}">${d}${isToday?' — TODAY':''}</span><div style="display:flex;align-items:center;gap:6px;"><div class="sched-pills">${isRest?'<span class="pill p-mt">REST</span>':pills+extra}</div><span style="font-size:10px;color:var(--mt);" id="ar_${d}">▼</span></div></div><div class="sched-exs" id="sd_${d}">${isRest?'<div style="color:var(--mt);font-size:11px;padding:3px 0;">Recovery day — rest is where gains happen.</div>':exs.map(e=>`<div class="ex-row"><div><div class="ex-name">${e.n}</div><div class="ex-detail">${e.s}</div></div></div>`).join('')}</div></div>`;
    }).join('');
}
window.toggleSched=(id,ar)=>{document.getElementById(id).classList.toggle('open');const a=document.getElementById(ar);if(a)a.textContent=document.getElementById(id).classList.contains('open')?'▲':'▼';};

async function updateMLPanel(){
    if(!document.getElementById('tab-ml')?.classList.contains('active'))return;
    const mlScore=await renderMLInsights(S,xpNeeded,drawForecastChart);
    S.mlScore=mlScore;renderNextTargets();updateStats();
}

function renderNextTargets(){
    const today=new Date().toISOString().split('T')[0];
    const recent=S.workoutHistory.filter(h=>h.date!==today).slice(-3);
    const cont=document.getElementById('nextTargets');if(!cont)return;
    if(!recent.length){cont.innerHTML='<div style="font-size:11px;color:var(--mt);">Log workouts to get personalised targets.</div>';return;}
    const exMap={};recent.forEach(s=>s.exercises.forEach(e=>{if(!exMap[e.name])exMap[e.name]=[];exMap[e.name].push(e);}));
    cont.innerHTML=Object.entries(exMap).slice(0,5).map(([name,hist])=>{
        const last=hist[hist.length-1],avg=hist.reduce((a,h)=>a+h.volume,0)/hist.length;
        const trend=last.volume>avg?'📈':last.volume<avg?'📉':'➡️';
        const sw=last.maxWeight>0?(last.maxWeight+2.5).toFixed(1):'—';
        const isPR=S.prs[name]&&S.prs[name].weight>=last.maxWeight;
        return `<div class="perf-row"><div><div class="ex-name">${name} ${isPR?'🏆':''}</div><div class="ex-detail">Last: ${Math.round(last.volume)}kg vol · ${last.maxWeight}kg max</div></div><div style="text-align:right;"><div style="font-size:11px;color:var(--gn);font-weight:700;">→ ${sw}kg</div><div style="font-size:10px;">${trend}</div></div></div>`;
    }).join('')||'<div style="font-size:11px;color:var(--mt);">Keep logging to get suggestions.</div>';
}

function drawForecastChart(pred,state,curLvl){
    const ctx=document.getElementById('forecastChart');if(!ctx)return;
    if(chartInstance)chartInstance.destroy();
    const weeks=8,labels=Array.from({length:weeks},(_,i)=>'W'+(i+1));
    const actual=Array.from({length:Math.min(Math.ceil(state.workoutsDone/Math.max(1,state.gymDays.length)),weeks)},(_,i)=>Math.round(curLvl+i*(curLvl>0?1:0.3)));
    const forecast=Array.from({length:weeks},(_,i)=>Math.round(curLvl+(i+1)*pred.forecast*2.5));
    chartInstance=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'Actual',data:[...actual,...Array(weeks-actual.length).fill(null)],borderColor:'#FF6B00',backgroundColor:'rgba(255,107,0,0.1)',tension:.4,pointRadius:4,borderWidth:2},{label:'ARIA Forecast',data:forecast,borderColor:'#AA44FF',backgroundColor:'rgba(170,68,255,0.08)',tension:.4,pointRadius:3,borderWidth:2,borderDash:[5,3]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8888aa',font:{size:10},boxWidth:12}},tooltip:{backgroundColor:'#13132a',titleColor:'#e8e8ff',bodyColor:'#8888aa',borderColor:'#2a2a50',borderWidth:1}},scales:{x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#8888aa',font:{size:9}}},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#8888aa',font:{size:9}}}}}});
}

// ── TAB SWITCHING ─────────────────────────────────────────────

window.switchTab=(tab,el)=>{
    document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('tab-'+tab).classList.add('active');
    if(tab==='ml')updateMLPanel();
    if(tab==='log')renderTodayLog();
    if(tab==='aria'&&ariaChatHistory.length===0)ariaInit();
    if(tab==='prs')renderPRs();
    if(tab==='friends'){renderFriendCode();renderFriendRequests();loadFriendsLeaderboard();}
};

// Mobile bottom nav
window.mobileSwitchTab=(tab,el)=>{
    document.querySelectorAll('.mobile-nav-item').forEach(n=>n.classList.remove('active'));
    el.classList.add('active');
    // Sync the hidden desktop tabs
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    const panel=document.getElementById('tab-'+tab);
    if(panel)panel.classList.add('active');
    if(tab==='ml')updateMLPanel();
    if(tab==='log')renderTodayLog();
    if(tab==='aria'&&ariaChatHistory.length===0)ariaInit();
    if(tab==='prs')renderPRs();
    if(tab==='friends'){renderFriendCode();renderFriendRequests();loadFriendsLeaderboard();}
};

// ── BADGES ───────────────────────────────────────────────────

const ACHS=[
    {id:'fw',  icon:'⚔️',n:'First Blood',    c:s=>s.workoutsDone>=1},
    {id:'log1',icon:'📋',n:'First Log',       c:s=>(s.workoutHistory||[]).length>=1},
    {id:'pr1', icon:'🏆',n:'First PR',        c:s=>Object.keys(s.prs||{}).length>=1},
    {id:'pr5', icon:'💎',n:'PR Machine',      c:s=>Object.keys(s.prs||{}).length>=5},
    {id:'pr10',icon:'👑',n:'PR Legend',       c:s=>Object.keys(s.prs||{}).length>=10},
    {id:'w7',  icon:'🗓️',n:'Week Warrior',   c:s=>s.bestStreak>=7},
    {id:'l5',  icon:'⭐',n:'Rising Star',     c:s=>s.level>=5},
    {id:'l10', icon:'🏆',n:'Decade Hero',     c:s=>s.level>=10},
    {id:'l20', icon:'👑',n:'Champion',        c:s=>s.level>=20},
    {id:'w10', icon:'💪',n:'Dedicated',       c:s=>s.workoutsDone>=10},
    {id:'p2',  icon:'⚡',n:'Phase 2',         c:s=>s.workoutsDone>=8},
    {id:'p3',  icon:'🔥',n:'Phase 3',         c:s=>s.workoutsDone>=16},
    {id:'p4',  icon:'💎',n:'Isolation Pro',   c:s=>s.workoutsDone>=28},
    {id:'x500',icon:'⚡',n:'XP Hunter',       c:s=>s.totalXP>=500},
    {id:'ml50',icon:'🤖',n:'ML Master',       c:s=>s.mlScore>=50},
    {id:'w50', icon:'🌟',n:'Legend',          c:s=>s.workoutsDone>=50},
    {id:'friend1',icon:'👥',n:'Social',       c:s=>(s.friends||[]).length>=1},
    {id:'aria',icon:'⚡',n:'ARIA Activated',  c:s=>(s.workoutHistory||[]).length>=1},
];
function renderAch(){
    const el=document.getElementById('achGrid');if(!el)return;
    el.innerHTML=ACHS.map(a=>{const u=a.c(S);return `<div class="ach-card ${u?'unlocked':''}"><div class="ach-icon">${a.icon}</div><div class="ach-name">${a.n}</div></div>`;}).join('');
}

function updateStats(){
    const safe=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    safe('stW',S.workoutsDone);safe('stS',S.bestStreak);safe('stX',S.totalXP);
    safe('stPR',Object.keys(S.prs||{}).length);
}

function showLU(){
    const l=S.level,cls=getCharCls(l),tier=getAvatarTier(l),prev=getAvatarTier(l-1);
    const newGear=tier.gear.filter(g=>!prev.gear.includes(g));
    const safe=(id,fn)=>{const el=document.getElementById(id);if(el)fn(el);};
    safe('luLvl',      el=>el.textContent=l);
    safe('luClsModal', el=>{el.textContent=cls.n.toUpperCase();el.style.color=cls.c;});
    safe('luSprite',   el=>el.innerHTML=buildAvatarSVG(l,tier));
    safe('luGearUnlock',el=>el.textContent=newGear.length?'🎁 NEW GEAR: '+newGear.join(', '):'');
    document.getElementById('luModal')?.classList.add('open');
    renderAch();
}
window.closeLU=()=>document.getElementById('luModal')?.classList.remove('open');
window.loadUserData=loadUserData;