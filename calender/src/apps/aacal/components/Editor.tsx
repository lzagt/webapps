import React, { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, collection, query, orderBy, updateDoc, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { db, auth } from '../../../lib/firebase';
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
            navigate('/aacal/onboarding', { replace: true });
          } else if (profiles.length === 1) {
            navigate(`/aacal/edit?userId=${profiles[0].id}`, { replace: true });
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
      <div className="aacal-container" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="glass-panel border-accent text-center animate-fade-in" style={{ padding: '40px 30px' }}>
          <div className="spinner" style={{ margin: '0 auto 20px auto', width: '40px', height: '40px' }}></div>
          <h2 style={{ color: 'var(--text-main)', fontSize: '20px', fontWeight: 'bold' }}>Checking Profiles...</h2>
        </div>
      </div>
    );
  }

  if (!userId && kidsList.length > 1) {
    return (
      <div className="aacal-container" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div className="glass-panel border-accent animate-fade-in" style={{ maxWidth: '600px', width: '100%', padding: '40px 30px', textAlign: 'center' }}>
          <div className="logo-container" style={{ marginBottom: '24px', display: 'inline-flex' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--accent)' }}>family_restroom</span>
          </div>
          <h2 className="text-gradient" style={{ fontSize: '28px', fontWeight: 800, marginBottom: '8px', fontFamily: "'Outfit', sans-serif" }}>Select a Planner to Edit</h2>
          <p className="text-secondary" style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '32px' }}>
            Multiple kid profiles are linked to your account. Select one to edit:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
            {kidsList.map(kid => (
              <button
                key={kid.id}
                onClick={() => navigate(`/aacal/edit?userId=${kid.id}`)}
                className="glass-panel border-accent-hover"
                style={{
                  padding: '24px 16px',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '16px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'transform 0.2s, border-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                }}
              >
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'var(--primary-gradient)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontWeight: 'bold',
                  fontSize: '20px'
                }}>
                  {kid.id.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '200px' }}>{kid.title.replace("'S PLANNER", "")}</h3>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>@{kid.id}</span>
                </div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
            <Link to="/aacal/onboarding" className="btn-link btn-save" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', padding: '12px 24px', borderRadius: '30px', margin: 0 }}>
              <span className="material-symbols-outlined">add_circle</span>
              Add Another Kid Profile
            </Link>
            <button 
              onClick={() => signOut(auth)} 
              className="btn btn-secondary"
              style={{ padding: '8px 20px', borderRadius: '20px' }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-8 text-center text-white">Loading Editor...</div>;
  if (!userData) {
    return (
      <div className="aacal-container" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="aacal-card border-accent text-center animate-fade-in" style={{ maxWidth: '480px', padding: '40px 30px', margin: '0 auto' }}>
          <div className="logo-container" style={{ background: 'var(--delete-gradient)', boxShadow: '0 8px 24px rgba(239, 68, 68, 0.3)', marginBottom: '24px', display: 'inline-flex' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#ffffff' }}>person_off</span>
          </div>
          <h2 className="text-gradient" style={{ fontSize: '24px', fontWeight: 800, marginBottom: '16px', fontFamily: "'Outfit', sans-serif" }}>Planner Not Found</h2>
          <p className="text-secondary" style={{ fontSize: '15px', lineHeight: 1.6, marginBottom: '28px', color: 'var(--text-muted)' }}>
            The kid profile you are trying to edit <strong style={{ color: 'var(--text-main)' }}>"{userId}"</strong> has not been set up in our system yet.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Link to="/aacal/onboarding" className="btn-link btn-save" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', padding: '12px 24px', borderRadius: '30px', fontWeight: 'bold', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add_circle</span>
              Create Kid Profile
            </Link>
            <Link to="/aacal" className="btn-link" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', padding: '12px 24px', borderRadius: '30px', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>arrow_back</span>
              Go Back to Main Page
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

  return (
    <div className="app-container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="logo-container" style={{ margin: 0 }}>
            <span className="material-symbols-outlined">edit_calendar</span>
          </div>
          <div style={{ textAlign: 'left' }}>
            <h1 style={{ margin: 0, fontSize: '28px' }}>Planner Editor</h1>
            <p style={{ margin: 0, opacity: 0.8 }}>Configure Weekly Schedule & Settings</p>
          </div>
        </div>

        {kidsList.length > 0 && (
          <div className="profile-switcher-container" style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', padding: '8px 16px', borderRadius: '24px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--accent)' }}>child_care</span>
            <span style={{ fontSize: '13px', fontWeight: 'bold' }}>Editing profile:</span>
            <select
              value={userId}
              onChange={(e) => navigate(`/aacal/edit?userId=${e.target.value}`)}
              style={{
                background: 'rgba(0,0,0,0.2)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px',
                padding: '4px 8px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {kidsList.map(kid => (
                <option key={kid.id} value={kid.id} style={{ background: '#1c1917', color: '#fff' }}>
                  {kid.title.replace("'S PLANNER", "")}
                </option>
              ))}
            </select>
            <Link 
              to="/aacal/onboarding" 
              className="btn-link btn-save" 
              style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none', borderRadius: '16px', margin: 0 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add</span>
              Add Kid
            </Link>
          </div>
        )}
      </header>

      <div className="nav-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Link to={`/aacal?userId=${userId}`} className="btn-link">
            <span className="material-symbols-outlined">arrow_back</span>
            Back to Planner Portal
          </Link>
          <Link to={`/aacal/achievements?userId=${userId}`} className="btn-link">
            <span className="material-symbols-outlined">emoji_events</span>
            View Achievements Wall
          </Link>
        </div>
        <button 
          onClick={() => signOut(auth)} 
          className="btn btn-secondary" 
          style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '8px 14px', fontSize: '13px' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>logout</span>
          Sign Out Parent
        </button>
      </div>

      <section className="meta-panel">
        <div className="meta-panel-header">
          <span className="material-symbols-outlined">settings</span>
          <h2>Weekly Planner Settings</h2>
        </div>

        <form onSubmit={saveMetadata}>
          <div className="grid-2col">
            <div>
              <div className="form-group">
                <label>Planner Title</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={metaTitle} 
                  onChange={(e) => setMetaTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Subtitle / Daily Checklist</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={metaSubtitle} 
                  onChange={(e) => setMetaSubtitle(e.target.value)}
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
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="submit" className="btn-link btn-save">
              <span className="material-symbols-outlined">save</span>
              Save Planner Settings
            </button>
          </div>
        </form>
      </section>

      <div className="editor-controls-bar" style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', marginBottom: '30px' }}>
        <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '24px', fontWeight: 700, margin: 0 }}>Daily Schedules</h2>

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
            <span className="focused-day-display">
              {schedule.find(d => d.id === focusedDayId)?.dayName || 'Select Day'}
            </span>
            <button className="nav-arrow-btn" onClick={goToNextDay}>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        )}
      </div>
      
      <div className="grid-double-panel">
        <main className={`planner-grid grid-${editViewMode}`}>
          {visibleDays.map((day) => (
            <div key={day.id} className="day-card" id={day.id}>
              <div className="day-header">
                <span className="day-name">{day.dayName}</span>
              </div>

              <div className="activity-editor-list">
                {(day.activities || []).map((act) => (
                  <div key={act.id} className="activity-edit-card" style={{ flexDirection: 'column', gap: '12px', padding: '16px', borderRadius: '16px', background: 'rgba(15, 23, 42, 0.4)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div className="activity-form-row" style={{ display: 'flex', gap: '12px' }}>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label style={{ fontSize: '10px' }}>From</label>
                        <input 
                          type="time" 
                          className="input-field" 
                          value={act.startTime || ''}
                          onChange={(e) => updateActivity(day.id, act.id, { startTime: e.target.value })}
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label style={{ fontSize: '10px' }}>To</label>
                        <input 
                          type="time" 
                          className="input-field" 
                          value={act.endTime || ''}
                          onChange={(e) => updateActivity(day.id, act.id, { endTime: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="activity-form-row" style={{ display: 'flex', gap: '12px' }}>
                      <div className="form-group" style={{ flex: 2 }}>
                        <label style={{ fontSize: '10px' }}>Task Name</label>
                        <select 
                          className="input-field" 
                          value={act.taskId || ''}
                          onChange={(e) => updateActivity(day.id, act.id, { taskId: e.target.value })}
                          style={{ color: '#fff', background: 'var(--input-bg)' }}
                        >
                          <option value="">-- Select Task --</option>
                          {(userData.tasks || []).map((t) => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label style={{ fontSize: '10px' }}>Credits</label>
                        <input 
                          type="number" 
                          className="input-field" 
                          min="0"
                          placeholder="0"
                          value={act.credits || ''}
                          onChange={(e) => updateActivity(day.id, act.id, { credits: parseInt(e.target.value, 10) || 0 })}
                        />
                      </div>
                    </div>

                    <div className="form-actions-row" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button 
                        className="btn-link btn-delete"
                        style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '15px' }}
                        onClick={() => deleteActivity(day.id, act.id)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="add-activity-container" style={{ marginTop: '24px' }}>
                <div className="add-activity-title">
                  <span className="material-symbols-outlined">add_circle</span>
                  Add New Activity
                </div>
                
                <form onSubmit={(e) => addActivity(day.id, e)}>
                  <div className="activity-form-row" style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>From Time</label>
                      <input name="startTime" type="time" className="input-field" required />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>To Time (Optional)</label>
                      <input name="endTime" type="time" className="input-field" />
                    </div>
                  </div>

                  <div className="activity-form-row" style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                    <div className="form-group" style={{ flex: 2 }}>
                      <label>Task</label>
                      <select name="taskId" className="input-field" required style={{ color: '#fff', background: 'var(--input-bg)' }}>
                        <option value="">-- Select Task --</option>
                        {(userData.tasks || []).map((t) => (
                          <option key={t.id} value={t.id}>{t.title}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Credits</label>
                      <input name="credits" type="number" min="0" className="input-field" placeholder="e.g. 5" />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                    <button type="submit" className="btn-link btn-save" style={{ padding: '8px 16px', fontSize: '12px', borderRadius: '20px' }}>
                      <span className="material-symbols-outlined">add</span>
                      Add Activity
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ))}
        </main>

        <aside className="glass-card" style={{ padding: '24px', borderRadius: '24px', background: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(255, 255, 255, 0.05)', position: 'sticky', top: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--accent-primary)', fontSize: '28px' }}>database</span>
            <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '20px', fontWeight: 700, margin: 0 }}>Task Library</h2>
          </div>

          <form onSubmit={handleAddTask} style={{ marginBottom: '24px' }}>
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label>Add Reusable Task</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g., Clean Bedroom"
                  maxLength={60}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value.replace(/[\n\r]/g, ''))}
                  required
                />
                <button type="submit" className="btn-link btn-save" style={{ padding: '10px 16px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>
              {taskError && (
                <p style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px', fontWeight: 500 }}>
                  {taskError}
                </p>
              )}
            </div>
          </form>

          <div className="task-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto', paddingRight: '4px' }}>
            {(userData.tasks || []).map((task) => (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: '14px', background: 'rgba(15, 23, 42, 0.3)', border: '1px solid rgba(255,255,255,0.03)' }}>
                {editingTaskId === task.id ? (
                  <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                    <input
                      type="text"
                      className="input-field"
                      value={editingTaskTitle}
                      maxLength={60}
                      onChange={(e) => setEditingTaskTitle(e.target.value.replace(/[\n\r]/g, ''))}
                      style={{ padding: '6px 12px', fontSize: '14px' }}
                      autoFocus
                    />
                    <button onClick={() => handleUpdateTask(task.id)} className="btn-link btn-save" style={{ padding: '6px 10px', borderRadius: '10px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>check</span>
                    </button>
                    <button onClick={() => setEditingTaskId(null)} className="btn-link" style={{ padding: '6px 10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-main)', wordBreak: 'break-word', marginRight: '12px' }}>
                      {task.title}
                    </span>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <button
                        onClick={() => {
                          setEditingTaskId(task.id);
                          setEditingTaskTitle(task.title);
                        }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
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
