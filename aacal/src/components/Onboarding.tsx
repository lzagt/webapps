import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { DaySchedule, UserMetadata, Activity } from '../types';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Login } from './Login';

const DEFAULT_TASKS = [
  { id: "task_1", title: "🌅 Wake Up & Morning Routine", time: "07:30", endTime: "08:00", credits: 1 },
  { id: "task_2", title: "🍳 Healthy Breakfast", time: "08:00", endTime: "08:30", credits: 1 },
  { id: "task_3", title: "🦷 Brush Teeth & Wash Face", time: "08:30", endTime: "08:45", credits: 1 },
  { id: "task_4", title: "🏫 School / Morning Session", time: "09:00", endTime: "12:00", credits: 5 },
  { id: "task_5", title: "🍱 Delicious Lunch & Break", time: "12:00", endTime: "13:00", credits: 1 },
  { id: "task_6", title: "💻 Speech Therapy Practice (AAC)", time: "14:00", endTime: "15:00", credits: 3 },
  { id: "task_7", title: "🌳 Outdoor Play or Afternoon Walk", time: "16:00", endTime: "17:00", credits: 2 },
  { id: "task_8", title: "🍲 Dinner with Family", time: "18:00", endTime: "19:00", credits: 1 },
  { id: "task_9", title: "🛁 Warm Bath & Prepare for Bed", time: "19:30", endTime: "20:00", credits: 1 },
  { id: "task_10", title: "📖 Bedtime Story & Good Night", time: "20:00", endTime: "20:30", credits: 1 }
];

const DAYS_OF_WEEK = [
  { name: "Monday", id: "monday", order: 0 },
  { name: "Tuesday", id: "tuesday", order: 1 },
  { name: "Wednesday", id: "wednesday", order: 2 },
  { name: "Thursday", id: "thursday", order: 3 },
  { name: "Friday", id: "friday", order: 4 },
  { name: "Saturday", id: "saturday", order: 5 },
  { name: "Sunday", id: "sunday", order: 6 }
];

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [kidName, setKidName] = useState('');
  const [kidId, setKidId] = useState('');
  const [pin, setPin] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<string[]>(DEFAULT_TASKS.map(t => t.id));
  
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [hasExistingKids, setHasExistingKids] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (authLoading || !currentUser) return;

    const checkExistingKids = async () => {
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('settings.parentId', '==', currentUser.uid));
        const snap = await getDocs(q);
        setHasExistingKids(!snap.empty);
      } catch (err) {
        console.error("Failed to check existing profiles in onboarding:", err);
      }
    };

    checkExistingKids();
  }, [currentUser, authLoading]);

  const handleNameChange = (val: string) => {
    setKidName(val);
    // Auto-generate kebab-case ID slug
    const slug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setKidId(slug);
  };

  const handleToggleTask = (taskId: string) => {
    setSelectedTasks(prev => 
      prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate inputs
    if (!kidName.trim()) {
      setError('Please enter your child\'s name.');
      return;
    }
    if (!kidId.trim() || !/^[a-z0-9-]+$/.test(kidId)) {
      setError('Kid Username/Slug must be lowercase alphanumeric characters and dashes only.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('Kid Mode PIN must be exactly 4 digits.');
      return;
    }
    if (selectedTasks.length === 0) {
      setError('Please select at least one task for the routine.');
      return;
    }

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        setError('You must be signed in as a parent to perform onboarding.');
        setSubmitting(false);
        return;
      }

      // 1. Check if kidId slug already exists
      const userRef = doc(db, 'users', kidId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        setError('This Kid Username/Slug is already in use. Please select a different one.');
        setSubmitting(false);
        return;
      }

      // 2. Map chosen tasks
      const tasksToSeed = DEFAULT_TASKS.filter(t => selectedTasks.includes(t.id)).map(t => ({
        id: t.id,
        title: t.title
      }));

      // 3. Write user profile document
      const newProfile: UserMetadata = {
        title: `${kidName.toUpperCase()}'S PLANNER`,
        subtitle: 'Daily Checklist & Routine',
        goals: [
          'Complete routines independently',
          'Practice communication using AAC'
        ],
        settings: {
          parentId: user.uid,
          pin: pin
        },
        tasks: tasksToSeed
      };

      await setDoc(userRef, newProfile);

      // 4. Seed 7 days weekly timetables
      for (const day of DAYS_OF_WEEK) {
        const activities: Activity[] = DEFAULT_TASKS
          .filter(t => selectedTasks.includes(t.id))
          .map((t, idx) => ({
            id: `act_${kidId}_${day.id}_${idx + 1}`,
            taskId: t.id,
            completed: false,
            startTime: t.time,
            endTime: t.endTime,
            credits: t.credits
          }));

        const dayRef = doc(db, 'users', kidId, 'schedule', day.id);
        await setDoc(dayRef, {
          dayName: day.name,
          order: day.order,
          activities
        });
      }

      // Success! Redirect parent to editor page for their new kid profile
      navigate(`/edit?userId=${kidId}`);
    } catch (err: any) {
      console.error('Onboarding failed:', err);
      setError(err.message || 'Onboarding setup failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <div className="p-8 text-center text-white">Loading Onboarding...</div>;
  }

  if (!currentUser) {
    return (
      <Login 
        onSuccess={() => {}}
      />
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[90vh] p-6">
      <div className="w-full max-w-xl p-8 md:p-10 rounded-3xl border border-violet-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in mx-4">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-violet-600/10 border border-violet-500/25">
            <span className="material-symbols-outlined text-violet-400" style={{ fontSize: '28px' }}>kids_star</span>
          </div>
          <h2 className="text-3xl font-extrabold text-white mt-4 mb-2 font-outfit">Planner Setup</h2>
          <p className="text-slate-400 text-sm leading-relaxed">Configure a personalized daily calendar planner checklist for your kid.</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3.5 mb-6 text-sm font-semibold text-red-200 bg-red-500/10 border border-red-500/25 rounded-xl">
            <span className="material-symbols-outlined flex-shrink-0 text-red-400" style={{ fontSize: '18px' }}>error</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {step === 1 && (
            <div className="flex flex-col gap-5 text-left">
              <div className="form-group">
                <label>Child's Name</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={kidName} 
                  placeholder="e.g. Alecia"
                  onChange={(e) => handleNameChange(e.target.value)} 
                  required
                />
              </div>

              <div className="form-group">
                <label>Kid Username / URL Slug</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={kidId} 
                  placeholder="e.g. alecia"
                  onChange={(e) => setKidId(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, ''))} 
                  required
                />
                <span className="text-xs text-slate-400 mt-2 block">
                  Public view link: /?userId=<strong className="text-violet-400">{kidId || '...'}</strong>
                </span>
              </div>

              <div className="form-group">
                <label>Kid Mode Access PIN (4 digits)</label>
                <input 
                  type="text" 
                  className="input-field" 
                  maxLength={4}
                  value={pin} 
                  placeholder="e.g. 1234"
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} 
                  required
                />
              </div>

              <button 
                type="button" 
                className="btn-success w-full mt-4 justify-center py-3.5 font-bold cursor-pointer flex items-center gap-2"
                onClick={() => {
                  if (kidName && kidId && pin.length === 4) {
                    setStep(2);
                  } else {
                    setError('Please fill in child\'s name, slug, and a 4-digit PIN.');
                  }
                }}
              >
                Configure Timetable
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
              
              {hasExistingKids && (
                <button
                  type="button"
                  className="nav-link w-full justify-center py-2.5 font-bold cursor-pointer"
                  onClick={() => navigate('/edit')}
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-5 text-left">
              <label className="text-sm font-bold text-slate-300 uppercase tracking-wider">Setup Daily Timetable Routines</label>
              <div className="max-h-[320px] overflow-y-auto pr-1 flex flex-col gap-3 scrollbar-thin">
                {DEFAULT_TASKS.map(t => (
                  <label 
                    key={t.id} 
                    className="flex items-center gap-4 p-4 rounded-2xl bg-slate-950/40 border border-white/5 cursor-pointer hover:bg-slate-950/60 hover:border-violet-500/30 transition-all select-none"
                  >
                    <input 
                      type="checkbox" 
                      checked={selectedTasks.includes(t.id)} 
                      onChange={() => handleToggleTask(t.id)}
                      className="w-5 h-5 rounded border-white/20 bg-slate-950 accent-violet-600 text-white cursor-pointer"
                    />
                    <div className="flex-1">
                      <span className="block font-bold text-sm text-white">{t.title}</span>
                      <span className="text-slate-400 text-xs font-medium">⏰ {t.time} (+{t.credits} Cr)</span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex gap-4 mt-6">
                <button 
                  type="button" 
                  className="nav-link flex-1 justify-center py-3 font-bold cursor-pointer"
                  onClick={() => setStep(1)}
                >
                  Back
                </button>
                <button 
                  type="submit" 
                  className="btn-success flex-[2] justify-center py-3 font-bold cursor-pointer"
                  disabled={submitting}
                >
                  {submitting ? 'Creating Profile...' : 'Complete & Launch 🚀'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
