import React, { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, collection, query, orderBy, updateDoc, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { DaySchedule, UserMetadata, Activity } from '../types';
import { PinPrompt } from './PinPrompt';
import { Login } from './Login';

export const Editor: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('userId') || '';

  const [userData, setUserData] = useState<UserMetadata | null>(null);
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [loading, setLoading] = useState(true);

  // Kids list for multi-profile selectors
  const [kidsList, setKidsList] = useState<{ id: string; title: string }[]>([]);
  const [checkingProfiles, setCheckingProfiles] = useState(!userId);

  // Auth states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubAuth();
  }, []);

  // Redirect or set kids list based on profiles owned by parent
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) {
      setCheckingProfiles(false);
      return;
    }

    const fetchKids = async () => {
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('settings.parentId', '==', currentUser.uid));
        const snap = await getDocs(q);

        const profiles = snap.docs.map(doc => ({
          id: doc.id,
          title: doc.data().title || `${doc.id.toUpperCase()}'S PLANNER`
        }));

        setKidsList(profiles);

        if (!userId) {
          if (profiles.length === 0) {
            navigate('/onboarding', { replace: true });
          } else if (profiles.length === 1) {
            navigate(`/edit?userId=${profiles[0].id}`, { replace: true });
          } else {
            setCheckingProfiles(false);
          }
        } else {
          setCheckingProfiles(false);
        }
      } catch (err) {
        console.error("Failed to fetch profiles:", err);
        setCheckingProfiles(false);
      }
    };

    fetchKids();
  }, [currentUser, authLoading, userId, navigate]);



  // Form states
  const [metaTitle, setMetaTitle] = useState('');
  const [metaSubtitle, setMetaSubtitle] = useState('');
  const [metaGoals, setMetaGoals] = useState('');

  // Day filter states
  const [focusedDayId, setFocusedDayId] = useState<string>('');
  const [editViewMode, setEditViewMode] = useState<'1' | '3' | '7'>('1');

  // PIN authentication state
  const [pinVerified, setPinVerified] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(`aacal_verified_${userId}`) === 'true';
    }
    return false;
  });

  // Task library states
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const [taskError, setTaskError] = useState('');


  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const userRef = doc(db, 'users', userId);
    const unsubUser = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data() as UserMetadata;
        setUserData(data);
        setMetaTitle(data.title || '');
        setMetaSubtitle(data.subtitle || '');
        setMetaGoals((data.goals || []).join('\n'));
      }
    });

    const scheduleRef = collection(db, 'users', userId, 'schedule');
    const q = query(scheduleRef, orderBy('order'));
    const unsubSchedule = onSnapshot(q, (snapshot) => {
      const days = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as DaySchedule[];
      setSchedule(days);
      setLoading(false);

      // Auto-focus today's weekday
      const todayName = new Date().toLocaleString('en-US', { weekday: 'long' });
      const todayDay = days.find(d => d.dayName.toLowerCase() === todayName.toLowerCase());
      if (todayDay) {
        setFocusedDayId(prev => prev || todayDay.id);
      } else if (days.length > 0) {
        setFocusedDayId(prev => prev || days[0].id);
      }
    });

    return () => {
      unsubUser();
      unsubSchedule();
    };
  }, [userId]);

  const saveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    const userRef = doc(db, 'users', userId);
    const goals = metaGoals.split('\n').map(g => g.trim()).filter(g => g.length > 0);
    await updateDoc(userRef, {
      title: metaTitle,
      subtitle: metaSubtitle,
      goals
    });
  };

  const addActivity = async (dayId: string, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const startTime = formData.get('startTime') as string;
    const endTime = formData.get('endTime') as string || '';
    const taskId = formData.get('taskId') as string;
    const credits = parseInt(formData.get('credits') as string, 10) || 0;

    if (!taskId) return;

    const dayRef = doc(db, 'users', userId, 'schedule', dayId);
    const day = schedule.find(d => d.id === dayId);
    if (!day) return;

    const newId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newActivity: Activity = {
      id: newId,
      startTime,
      endTime,
      taskId,
      credits,
      completed: false
    };

    // Auto-sort chronologically by startTime on save
    const updatedActivities = [...(day.activities || []), newActivity].sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      return 0;
    });

    await updateDoc(dayRef, { activities: updatedActivities });
    e.currentTarget.reset();
  };

  const updateActivity = async (dayId: string, activityId: string, updates: Partial<Activity>) => {
    const dayRef = doc(db, 'users', userId, 'schedule', dayId);
    const day = schedule.find(d => d.id === dayId);
    if (!day) return;

    const updatedActivities = day.activities.map(act => {
      if (act.id === activityId) {
        return { ...act, ...updates };
      }
      return act;
    }).sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      return 0;
    });

    await updateDoc(dayRef, { activities: updatedActivities });
  };

  const deleteActivity = async (dayId: string, activityId: string) => {
    if (!confirm('Are you sure you want to delete this activity?')) return;
    
    const dayRef = doc(db, 'users', userId, 'schedule', dayId);
    const day = schedule.find(d => d.id === dayId);
    if (!day) return;

    const updatedActivities = day.activities.filter(act => act.id !== activityId);
    await updateDoc(dayRef, { activities: updatedActivities });
  };

  // Task library management
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;
    if (title.length > 60) {
      setTaskError('Task title must be 60 characters or less.');
      return;
    }
    if (/[\n\r]/.test(title)) {
      setTaskError('Task title must be a single line.');
      return;
    }

    const userRef = doc(db, 'users', userId);
    const updatedTasks = [...(userData?.tasks || []), {
      id: `task_${Date.now()}`,
      title
    }];

    await updateDoc(userRef, { tasks: updatedTasks });
    setNewTaskTitle('');
    setTaskError('');
  };

  const handleUpdateTask = async (taskId: string) => {
    const title = editingTaskTitle.trim();
    if (!title) return;
    if (title.length > 60) {
      setTaskError('Task title must be 60 characters or less.');
      return;
    }
    if (/[\n\r]/.test(title)) {
      setTaskError('Task title must be a single line.');
      return;
    }

    const userRef = doc(db, 'users', userId);
    const updatedTasks = (userData?.tasks || []).map(t => {
      if (t.id === taskId) {
        return { ...t, title };
      }
      return t;
    });

    await updateDoc(userRef, { tasks: updatedTasks });
    setEditingTaskId(null);
    setEditingTaskTitle('');
    setTaskError('');
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task from the library? Scheduled activities pointing to it will display as deleted.')) return;

    const userRef = doc(db, 'users', userId);
    const filteredTasks = (userData?.tasks || []).filter(t => t.id !== taskId);

    await updateDoc(userRef, { tasks: filteredTasks });
  };

  // Navigation handlers
  const goToPrevDay = () => {
    const idx = schedule.findIndex(d => d.id === focusedDayId);
    if (idx === -1) return;
    const prevIdx = (idx - 1 + schedule.length) % schedule.length;
    setFocusedDayId(schedule[prevIdx].id);
  };

  const goToNextDay = () => {
    const idx = schedule.findIndex(d => d.id === focusedDayId);
    if (idx === -1) return;
    const nextIdx = (idx + 1) % schedule.length;
    setFocusedDayId(schedule[nextIdx].id);
  };

  if (authLoading) return <div className="p-8 text-center text-white">Loading Editor...</div>;
  if (!currentUser) {
    return (
      <Login 
        onSuccess={() => {}} 
      />
    );
  }

  if (checkingProfiles) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] px-4">
        <div className="w-full max-w-md p-8 text-center rounded-3xl border border-violet-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="spinner mx-auto mb-6 w-10 h-10"></div>
          <h2 className="text-xl font-bold text-white tracking-tight">Checking Profiles...</h2>
        </div>
      </div>
    );
  }

  if (!userId && kidsList.length > 1) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] p-6">
        <div className="w-full max-w-2xl p-8 md:p-12 text-center rounded-3xl border border-violet-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-violet-600/10 border border-violet-500/25">
            <span className="material-symbols-outlined text-violet-400" style={{ fontSize: '32px' }}>family_restroom</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2 font-outfit">Select a Planner to Edit</h2>
          <p className="text-slate-300 mb-8 max-w-md mx-auto">
            Multiple kid profiles are linked to your account. Select one to edit:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {kidsList.map(kid => (
              <button
                key={kid.id}
                onClick={() => navigate(`/edit?userId=${kid.id}`)}
                className="flex flex-col items-center gap-4 p-6 rounded-2xl border border-white/5 bg-slate-900/20 hover:bg-slate-900/40 hover:border-violet-500/50 hover:-translate-y-1 transition-all duration-300 cursor-pointer text-center group"
              >
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-violet-500/10 group-hover:scale-105 transition-transform">
                  {kid.id.charAt(0).toUpperCase()}
                </div>
                <div className="w-full">
                  <h3 className="text-base font-bold text-white truncate max-w-full">{kid.title.replace("'S PLANNER", "")}</h3>
                  <span className="text-xs text-slate-400">@{kid.id}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link to="/onboarding" className="nav-link btn-save">
              <span className="material-symbols-outlined">add_circle</span>
              Add Another Kid Profile
            </Link>
            <button 
              onClick={() => signOut(auth)} 
              className="nav-link btn-delete"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="flex items-center justify-center min-h-[80vh] text-slate-300 font-bold">Loading Editor...</div>;
  if (!userData) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] p-6">
        <div className="w-full max-w-md p-8 md:p-10 text-center rounded-3xl border border-red-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-red-600/10 border border-red-500/25 shadow-lg shadow-red-500/10">
            <span className="material-symbols-outlined text-red-400" style={{ fontSize: '32px' }}>person_off</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white mb-4 font-outfit">Planner Not Found</h2>
          <p className="text-slate-300 leading-relaxed mb-8">
            The kid profile you are trying to edit <strong className="text-white">"{userId}"</strong> has not been set up in our system yet.
          </p>
          <div className="flex flex-col gap-4">
            <Link to="/onboarding" className="nav-link btn-save justify-center">
              <span className="material-symbols-outlined">add_circle</span>
              Create Kid Profile
            </Link>
            <Link to="/" className="nav-link justify-center">
              <span className="material-symbols-outlined">arrow_back</span>
              Go Back to Main Page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isOwner = userData.settings?.parentId === currentUser?.uid;
  if (!isOwner) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] p-6">
        <div className="w-full max-w-md p-8 md:p-10 text-center rounded-3xl border border-red-500/20 bg-slate-900/40 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-red-600/10 border border-red-500/25 shadow-lg shadow-red-500/10">
            <span className="material-symbols-outlined text-red-400" style={{ fontSize: '32px' }}>gavel</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white mb-4 font-outfit">Access Denied</h2>
          <p className="text-slate-300 leading-relaxed mb-8">
            You do not have permission to edit the profile <strong className="text-white">"{userId}"</strong>.
          </p>
          <div className="flex justify-center">
            <Link to="/edit" className="nav-link">
              <span className="material-symbols-outlined">arrow_back</span>
              Go to Your Profiles
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Compute visible day cards for editor
  const currentFocusIndex = schedule.findIndex(d => d.id === focusedDayId);
  let visibleDays: DaySchedule[] = [];
  if (schedule.length > 0 && currentFocusIndex !== -1) {
    if (editViewMode === '1') {
      visibleDays = [schedule[currentFocusIndex]];
    } else if (editViewMode === '3') {
      const idxs = [
        (currentFocusIndex - 1 + schedule.length) % schedule.length,
        currentFocusIndex,
        (currentFocusIndex + 1) % schedule.length
      ];
      visibleDays = idxs.map(i => schedule[i]).filter(Boolean);
    } else {
      visibleDays = schedule;
    }
  }

  const getGridClass = () => {
    if (editViewMode === '1') return "grid grid-cols-1 max-w-2xl mx-auto gap-8 mb-12 animate-fade-in";
    if (editViewMode === '3') return "grid grid-cols-1 md:grid-cols-3 gap-8 mb-12 animate-fade-in";
    return "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-6 mb-12 animate-fade-in";
  };

  return (
    <div className="app-container px-4 py-8">
      {/* Brand Header Row */}
      <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between w-full mb-10">
        <div className="flex items-center gap-4">
          <div className="logo-container flex-shrink-0">
            <span className="material-symbols-outlined">edit_calendar</span>
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white leading-tight font-outfit">Planner Editor</h1>
            <p className="text-slate-400 text-sm font-medium">Configure Weekly Schedule &amp; Settings</p>
          </div>
        </div>

        {kidsList.length > 0 && (
          <div className="flex items-center gap-3 bg-slate-900/60 border border-white/5 p-2 rounded-2xl backdrop-blur-md">
            <span className="material-symbols-outlined text-violet-400 ml-2" style={{ fontSize: '18px' }}>child_care</span>
            <span className="text-xs font-bold text-slate-300">Editing Profile:</span>
            <select
              value={userId}
              onChange={(e) => navigate(`/edit?userId=${e.target.value}`)}
              className="bg-slate-950 text-white text-xs font-bold py-1.5 px-3 rounded-lg border border-white/10 outline-none cursor-pointer focus:border-violet-500 transition-colors"
            >
              {kidsList.map(kid => (
                <option key={kid.id} value={kid.id} className="bg-slate-950 text-white">
                  {kid.title.replace("'S PLANNER", "")}
                </option>
              ))}
            </select>
            <Link 
              to="/onboarding" 
              className="nav-link btn-save py-1.5 px-3 text-xs font-bold inline-flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-xs">add</span>
              Add Profile
            </Link>
          </div>
        )}
      </header>

      {/* Main Options Menu Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between w-full mb-10 pb-6 border-b border-white/5">
        <div className="flex gap-3">
          <Link to={`/?userId=${userId}`} className="nav-link py-2.5 px-5 text-sm font-semibold">
            <span className="material-symbols-outlined">arrow_back</span>
            Back to Planner
          </Link>
          <Link to={`/achievements?userId=${userId}`} className="nav-link py-2.5 px-5 text-sm font-semibold">
            <span className="material-symbols-outlined">emoji_events</span>
            Achievements Wall
          </Link>
        </div>
        <button 
          onClick={() => signOut(auth)} 
          className="nav-link btn-delete py-2.5 px-5 text-sm font-semibold flex items-center justify-center"
        >
          <span className="material-symbols-outlined">logout</span>
          Sign Out Parent
        </button>
      </div>

      {/* Settings Form Container */}
      <section className="meta-panel shadow-lg">
        <div className="meta-panel-header">
          <span className="material-symbols-outlined">settings</span>
          <h2>Weekly Planner Settings</h2>
        </div>

        <form onSubmit={saveMetadata}>
          <div className="grid-2col">
            <div className="flex flex-col gap-4">
              <div className="form-group">
                <label>Planner Title</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={metaTitle} 
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder="e.g., BRADY'S PLANNER"
                />
              </div>

              <div className="form-group">
                <label>Subtitle / Daily Checklist</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={metaSubtitle} 
                  onChange={(e) => setMetaSubtitle(e.target.value)}
                  placeholder="e.g., Daily Checklist & Routine"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Weekly Goals &amp; Habits (One per line)</label>
              <textarea 
                rows={5} 
                className="textarea-field" 
                value={metaGoals}
                onChange={(e) => setMetaGoals(e.target.value)}
                placeholder="e.g., Brush teeth without being asked&#10;Complete all speech exercises"
              />
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button type="submit" className="nav-link btn-save py-2.5 px-6 font-semibold shadow-lg">
              <span className="material-symbols-outlined">save</span>
              Save Settings
            </button>
          </div>
        </form>
      </section>

      {/* Header controls for Schedule Grid */}
      <div className="flex flex-col gap-4 items-center justify-between w-full mb-8 pt-6">
        <h2 className="text-2xl font-extrabold text-white font-outfit">Daily Schedules</h2>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6 mt-2">
          <div className="view-mode-selector">
            {(['1', '3', '7'] as const).map((mode) => (
              <button
                key={mode}
                className={`selector-btn ${editViewMode === mode ? 'active' : ''}`}
                onClick={() => setEditViewMode(mode)}
              >
                {mode === '1' ? 'Edit 1 Day' : mode === '3' ? 'Edit 3 Days' : 'Edit 7 Days'}
              </button>
            ))}
          </div>

          {editViewMode !== '7' && schedule.length > 0 && (
            <div className="day-navigator">
              <button className="nav-arrow-btn" onClick={goToPrevDay}>
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <span className="focused-day-display font-semibold">
                {schedule.find(d => d.id === focusedDayId)?.dayName || 'Select Day'}
              </span>
              <button className="nav-arrow-btn" onClick={goToNextDay}>
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Schedule editor grid + task library sidebar */}
      <div className="grid-double-panel items-start">
        <main className={getGridClass()}>
          {visibleDays.map((day) => (
            <div key={day.id} className="day-card" id={day.id}>
              <div className="day-header pb-4 mb-6 border-b border-white/5">
                <span className="day-name text-2xl font-extrabold text-white font-outfit">{day.dayName}</span>
              </div>

              <div className="activity-editor-list flex flex-col gap-4">
                {(day.activities || []).map((act) => (
                  <div 
                    key={act.id} 
                    className="activity-edit-card flex flex-col gap-4 p-4 rounded-2xl bg-slate-900/30 border border-white/5 shadow-inner"
                  >
                    <div className="flex gap-3">
                      <div className="form-group flex-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">From</label>
                        <input 
                          type="time" 
                          className="input-field py-2 px-3 text-xs" 
                          value={act.startTime || ''}
                          onChange={(e) => updateActivity(day.id, act.id, { startTime: e.target.value })}
                        />
                      </div>
                      <div className="form-group flex-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">To</label>
                        <input 
                          type="time" 
                          className="input-field py-2 px-3 text-xs" 
                          value={act.endTime || ''}
                          onChange={(e) => updateActivity(day.id, act.id, { endTime: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 items-end">
                      <div className="form-group flex-[2]">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Task</label>
                        <select 
                          className="input-field py-2 px-3 text-xs bg-slate-950 text-white" 
                          value={act.taskId || ''}
                          onChange={(e) => updateActivity(day.id, act.id, { taskId: e.target.value })}
                        >
                          <option value="" className="text-slate-400">Select Task</option>
                          {(userData.tasks || []).map((t) => (
                            <option key={t.id} value={t.id} className="text-white bg-slate-950">{t.title}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group flex-[1]">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Credits</label>
                        <input 
                          type="number" 
                          className="input-field py-2 px-3 text-xs" 
                          min="0"
                          placeholder="0"
                          value={act.credits || ''}
                          onChange={(e) => updateActivity(day.id, act.id, { credits: parseInt(e.target.value, 10) || 0 })}
                        />
                      </div>
                    </div>

                    <div className="flex justify-end border-t border-white/5 pt-3">
                      <button 
                        className="nav-link btn-delete py-1.5 px-3 text-[11px] font-bold flex items-center gap-1"
                        onClick={() => deleteActivity(day.id, act.id)}
                      >
                        <span className="material-symbols-outlined text-[13px]">delete</span>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Activity Section inside Day Card */}
              <div className="mt-8 pt-6 border-t border-white/5">
                <div className="flex items-center gap-2 mb-4 text-slate-300 font-bold text-sm tracking-tight">
                  <span className="material-symbols-outlined text-violet-400" style={{ fontSize: '18px' }}>add_circle</span>
                  Add Activity
                </div>
                
                <form onSubmit={(e) => addActivity(day.id, e)} className="flex flex-col gap-4">
                  <div className="flex gap-3">
                    <div className="form-group flex-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">From Time</label>
                      <input name="startTime" type="time" className="input-field py-2 px-3 text-xs" required />
                    </div>
                    <div className="form-group flex-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">To Time</label>
                      <input name="endTime" type="time" className="input-field py-2 px-3 text-xs" />
                    </div>
                  </div>

                  <div className="flex gap-3 items-end">
                    <div className="form-group flex-[2]">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Task</label>
                      <select name="taskId" className="input-field py-2 px-3 text-xs bg-slate-950 text-white" required>
                        <option value="" className="text-slate-400">Select Task</option>
                        {(userData.tasks || []).map((t) => (
                          <option key={t.id} value={t.id} className="text-white bg-slate-950">{t.title}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group flex-[1]">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Credits</label>
                      <input name="credits" type="number" min="0" className="input-field py-2 px-3 text-xs" placeholder="e.g. 5" />
                    </div>
                  </div>

                  <div className="flex justify-end mt-2">
                    <button type="submit" className="nav-link btn-save py-2 px-4 text-xs font-bold">
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      Add to Schedule
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ))}
        </main>

        <aside className="w-full lg:w-[360px] p-6 rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-xl lg:sticky lg:top-6 flex-shrink-0 animate-fade-in mb-12">
          <div className="flex items-center gap-3 pb-4 mb-6 border-b border-white/5">
            <span className="material-symbols-outlined text-violet-400" style={{ fontSize: '24px' }}>database</span>
            <h2 className="text-lg font-extrabold text-white font-outfit">Task Library</h2>
          </div>

          <form onSubmit={handleAddTask} className="mb-6">
            <div className="form-group">
              <label>Add Reusable Task</label>
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  className="input-field py-2.5 px-4 text-sm"
                  placeholder="e.g., Clean Bedroom"
                  maxLength={60}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value.replace(/[\n\r]/g, ''))}
                  required
                />
                <button type="submit" className="nav-link btn-save py-2 px-4 rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
              </div>
              {taskError && (
                <p className="text-red-400 text-xs font-semibold mt-2">
                  {taskError}
                </p>
              )}
            </div>
          </form>

          <div className="task-list max-h-[500px] overflow-y-auto pr-1 flex flex-col gap-3 scrollbar-thin">
            {(userData.tasks || []).map((task) => (
              <div 
                key={task.id} 
                className="flex items-center justify-between p-4 rounded-2xl bg-slate-950/40 border border-white/5 shadow-sm hover:border-white/10 transition-colors"
              >
                {editingTaskId === task.id ? (
                  <div className="flex gap-2 w-full">
                    <input
                      type="text"
                      className="input-field py-1.5 px-3 text-xs"
                      value={editingTaskTitle}
                      maxLength={60}
                      onChange={(e) => setEditingTaskTitle(e.target.value.replace(/[\n\r]/g, ''))}
                      autoFocus
                    />
                    <button onClick={() => handleUpdateTask(task.id)} className="nav-link btn-save p-1.5 min-w-0 rounded-lg">
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    </button>
                    <button onClick={() => setEditingTaskId(null)} className="nav-link p-1.5 min-w-0 rounded-lg bg-slate-800 hover:bg-slate-700">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-slate-200 truncate pr-3 select-all">
                      {task.title}
                    </span>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          setEditingTaskId(task.id);
                          setEditingTaskTitle(task.title);
                        }}
                        className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white cursor-pointer"
                        title="Edit task name"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 cursor-pointer"
                        title="Delete task from library"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};
