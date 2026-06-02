import React, { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { collection, doc, onSnapshot, query, orderBy, updateDoc, setDoc, deleteDoc, serverTimestamp, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { DaySchedule, UserMetadata, Activity, Achievement } from '../types';
import { PinPrompt } from './PinPrompt';
import { Login } from './Login';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('userId') || '';
  
  const [userData, setUserData] = useState<UserMetadata | null>(null);
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  // Kids list for multi-profile selectors
  const [kidsList, setKidsList] = useState<{ id: string; title: string }[]>([]);
  const [checkingProfiles, setCheckingProfiles] = useState(!userId);

  
  // Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showGoals, setShowGoals] = useState(false);


  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubAuth();
  }, []);

  // Redirect or set kids list based on profiles owned by parent
  useEffect(() => {
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
            navigate(`/?userId=${profiles[0].id}`, { replace: true });
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
  }, [currentUser, userId, navigate]);

  // Auto-redirect to onboarding if userId/empty and profile doesn't exist (first-time visitor)
  useEffect(() => {
    if (loading || checkingProfiles) return;

    if (!userData && !userId && !currentUser) {
      navigate('/onboarding', { replace: true });
    }
  }, [loading, userData, userId, navigate, checkingProfiles, currentUser]);



  // Focus day state & View Mode state
  const [focusedDayId, setFocusedDayId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'1' | '3' | '5' | '7'>('1');

  // PIN authentication state
  const [pinVerified, setPinVerified] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(`aacal_verified_${userId}`) === 'true';
    }
    return false;
  });

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const userRef = doc(db, 'users', userId);
    const unsubUser = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setUserData(doc.data() as UserMetadata);
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

    const achievementsRef = collection(db, 'users', userId, 'achievements');
    const unsubAchievements = onSnapshot(achievementsRef, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Achievement[];
      setAchievements(list);
    });

    return () => {
      unsubUser();
      unsubSchedule();
      unsubAchievements();
    };
  }, [userId]);

  const getLagStatus = (endTime?: string): 'On-Time' | 'A bit late' | 'Late' => {
    if (!endTime) return 'On-Time';
    const now = new Date();
    const checkInMinutes = now.getHours() * 60 + now.getMinutes();
    const [endHour, endMin] = endTime.split(':').map(Number);
    const endMinutes = endHour * 60 + endMin;
    const lag = checkInMinutes - endMinutes;
    if (lag <= 0) return 'On-Time';
    if (lag <= 15) return 'A bit late';
    return 'Late';
  };

  const toggleActivity = async (dayId: string, activityId: string, completed: boolean) => {
    const dayRef = doc(db, 'users', userId, 'schedule', dayId);
    const day = schedule.find(d => d.id === dayId);
    if (!day) return;

    const activity = day.activities.find(act => act.id === activityId);
    if (!activity) return;

    const updatedActivities = day.activities.map(act => {
      if (act.id === activityId) {
        return { ...act, completed: !completed };
      }
      return act;
    });

    await updateDoc(dayRef, { activities: updatedActivities });

    // Handle achievements log
    const dateStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const achievementId = `${dateStr}_${activityId}`;
    const achievementRef = doc(db, 'users', userId, 'achievements', achievementId);

    if (!completed) {
      // Toggling to completed -> create pending achievement
      const task = userData?.tasks?.find(t => t.id === activity.taskId);
      const taskTitle = task ? task.title : 'Unknown Task';
      const credits = activity.credits || 0;
      const lagStatus = getLagStatus(activity.endTime);

      await setDoc(achievementRef, {
        id: achievementId,
        activityId,
        taskId: activity.taskId,
        taskTitle,
        credits,
        completedAt: serverTimestamp(),
        date: dateStr,
        dayId,
        status: 'pending',
        lagStatus
      });
    } else {
      // Toggling to incomplete -> delete achievement log (both pending or approved)
      await deleteDoc(achievementRef);
    }
  };

  // Helper: dynamic period classification
  const getPeriod = (act: Activity): 'Morning' | 'Afternoon' | 'Evening' => {
    if (act.startTime) {
      const hour = parseInt(act.startTime.split(':')[0], 10);
      if (hour < 12) return 'Morning';
      if (hour < 17) return 'Afternoon';
      return 'Evening';
    }
    return 'Morning';
  };

  // Helper: beautifully display start/end time
  const formatTime = (time24?: string): string => {
    if (!time24) return '';
    const parts = time24.split(':');
    if (parts.length < 2) return time24;
    const h = parseInt(parts[0], 10);
    const mStr = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${mStr} ${ampm}`;
  };

  const getDisplayTime = (act: Activity): string => {
    if (act.startTime) {
      return act.endTime 
        ? `${formatTime(act.startTime)} - ${formatTime(act.endTime)}`
        : formatTime(act.startTime);
    }
    return '';
  };

  // Helper: sort activities chronologically
  const sortActivities = (activities: Activity[]): Activity[] => {
    return [...(activities || [])].sort((a, b) => {
      if (a.startTime && b.startTime) {
        return a.startTime.localeCompare(b.startTime);
      }
      return 0;
    });
  };

  const getJsDate = (ts: any) => {
    if (!ts) return new Date();
    if (ts.toDate) return ts.toDate();
    if (ts.seconds) return new Date(ts.seconds * 1000);
    return new Date(ts);
  };

  const isActivityApproved = (actId: string) => {
    const matching = achievements.filter(a => a.activityId === actId);
    if (matching.length === 0) return false;
    const latest = matching.reduce((latestSoFar, current) => {
      const timeL = getJsDate(latestSoFar.completedAt).getTime();
      const timeC = getJsDate(current.completedAt).getTime();
      return timeC > timeL ? current : latestSoFar;
    });
    return latest.status === 'approved';
  };

  // Helper: calculate day credits progress
  const dayCredits = (day: DaySchedule) => {
    return (day.activities || [])
      .filter(a => a.completed && a.credits && isActivityApproved(a.id))
      .reduce((sum, a) => sum + (a.credits || 0), 0);
  };

  const totalPossibleCredits = (day: DaySchedule) => {
    return (day.activities || [])
      .filter(a => a.credits)
      .reduce((sum, a) => sum + (a.credits || 0), 0);
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

  const getTaskTitle = (taskId: string): string => {
    if (!userData || !userData.tasks) return '(Deleted Task)';
    const task = userData.tasks.find(t => t.id === taskId);
    return task ? task.title : '(Deleted Task)';
  };

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
          <h2 className="text-gradient" style={{ fontSize: '28px', fontWeight: 800, marginBottom: '8px', fontFamily: "'Outfit', sans-serif" }}>Select a Planner</h2>
          <p className="text-secondary" style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '32px' }}>
            Multiple kid profiles are linked to your account. Select one to view:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
            {kidsList.map(kid => (
              <button
                key={kid.id}
                onClick={() => navigate(`/?userId=${kid.id}`)}
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
            <Link to="/onboarding" className="btn-link btn-save" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', padding: '12px 24px', borderRadius: '30px', margin: 0 }}>
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

  if (loading) return <div className="p-8 text-center text-white">Loading Planner...</div>;
  if (!userData) {
    if (!userId && !currentUser) {
      return (
        <div className="aacal-container" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="glass-panel border-accent text-center animate-fade-in" style={{ maxWidth: '500px', width: '100%', padding: '40px 30px' }}>
            <div className="logo-container" style={{ marginBottom: '24px', display: 'inline-flex' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--accent)' }}>child_care</span>
            </div>
            <h2 className="text-gradient" style={{ fontSize: '28px', fontWeight: 800, marginBottom: '16px', fontFamily: "'Outfit', sans-serif" }}>AAC Planner Portal</h2>
            <p className="text-secondary" style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '32px', lineHeight: 1.6 }}>
              Welcome to the AAC Planner. Please authenticate as a parent to manage calendars, or use the direct public link provided by your parent to access Kid Mode.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
              <button 
                onClick={() => setShowLogin(true)} 
                className="btn-link btn-save" 
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 28px', borderRadius: '30px', fontWeight: 'bold', border: 'none', cursor: 'pointer', margin: 0 }}
              >
                <span className="material-symbols-outlined">lock</span>
                Parent Portal Login
              </button>
            </div>
          </div>
          
          {showLogin && (
            <Login 
              onSuccess={() => setShowLogin(false)}
              onCancel={() => setShowLogin(false)}
            />
          )}
        </div>
      );
    }

    return (
      <div className="aacal-container" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="aacal-card border-accent text-center animate-fade-in" style={{ maxWidth: '480px', padding: '40px 30px', margin: '0 auto' }}>
          <div className="logo-container" style={{ background: 'var(--delete-gradient)', boxShadow: '0 8px 24px rgba(239, 68, 68, 0.3)', marginBottom: '24px', display: 'inline-flex' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#ffffff' }}>person_off</span>
          </div>
          <h2 className="text-gradient" style={{ fontSize: '24px', fontWeight: 800, marginBottom: '16px', fontFamily: "'Outfit', sans-serif" }}>Planner Not Found</h2>
          <p className="text-secondary" style={{ fontSize: '15px', lineHeight: 1.6, marginBottom: '28px', color: 'var(--text-muted)' }}>
            The kid profile link <strong style={{ color: 'var(--text-main)' }}>"{userId}"</strong> has not been set up in our system yet.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Link to="/onboarding" className="btn-link btn-save" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', padding: '12px 24px', borderRadius: '30px', fontWeight: 'bold', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add_circle</span>
              Create Kid Profile
            </Link>
            <Link to="/" className="btn-link" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', padding: '12px 24px', borderRadius: '30px', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>arrow_back</span>
              Go Back to Main Page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isParentActive = !!(currentUser && userData && userData.settings?.parentId === currentUser.uid);
  const requiresPin = userData.settings?.pin ? true : false;
  const isAuthorized = !requiresPin || pinVerified;

  if (!isAuthorized && userData.settings?.pin) {
    return (
      <PinPrompt
        correctPin={userData.settings.pin}
        title="Verification Required"
        onVerify={() => {
          setPinVerified(true);
          sessionStorage.setItem(`aacal_verified_${userId}`, 'true');
        }}
      />
    );
  }

  const currentDayName = new Date().toLocaleString('en-US', { weekday: 'long' });

  // Compute visible day cards
  const currentFocusIndex = schedule.findIndex(d => d.id === focusedDayId);
  let visibleDays: DaySchedule[] = [];
  if (schedule.length > 0 && currentFocusIndex !== -1) {
    if (viewMode === '1') {
      visibleDays = [schedule[currentFocusIndex]];
    } else if (viewMode === '3') {
      const idxs = [
        (currentFocusIndex - 1 + schedule.length) % schedule.length,
        currentFocusIndex,
        (currentFocusIndex + 1) % schedule.length
      ];
      visibleDays = idxs.map(i => schedule[i]).filter(Boolean);
    } else if (viewMode === '5') {
      const idxs = [
        (currentFocusIndex - 2 + schedule.length) % schedule.length,
        (currentFocusIndex - 1 + schedule.length) % schedule.length,
        currentFocusIndex,
        (currentFocusIndex + 1) % schedule.length,
        (currentFocusIndex + 2) % schedule.length
      ];
      visibleDays = idxs.map(i => schedule[i]).filter(Boolean);
    } else {
      visibleDays = schedule;
    }
  }

  // Compute overall reward scorecard for focused day (or active display)
  const focusedDay = schedule[currentFocusIndex];
  const activeDayEarned = focusedDay ? dayCredits(focusedDay) : 0;
  const activeDayPossible = focusedDay ? totalPossibleCredits(focusedDay) : 0;

  return (
    <div className="app-container">
      <header style={{ position: 'relative' }}>
        <div className="parent-auth-header-controls" style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          {isParentActive ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge-lag lag-on-time" style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>lock_open</span>
                Parent Active
              </span>
              <button 
                onClick={() => signOut(auth)} 
                className="btn btn-secondary" 
                style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
              >
                Logout
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {currentUser && (
                <span className="badge-lag lag-late" style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  Wrong Parent
                </span>
              )}
              <button 
                onClick={() => setShowLogin(true)} 
                className="btn btn-secondary" 
                style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>lock</span>
                Parent Login
              </button>
            </div>
          )}
        </div>
        <div className="compact-header-brand" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div className="logo-container" style={{ margin: 0 }}>
            <span className="material-symbols-outlined">calendar_today</span>
          </div>
          <div style={{ textAlign: 'left' }}>
            <h1 style={{ fontSize: '28px', margin: 0, lineHeight: 1.2 }}>{userData.title || 'WEEKLY PLANNER'}</h1>
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.8 }}>{userData.subtitle || 'Daily Checklist'}</p>
          </div>
        </div>

        {activeDayPossible > 0 && (
          <div className="credits-scorecard">
            <span className="material-symbols-outlined star-icon">grade</span>
            <span className="credits-text">
              <strong>{focusedDay?.dayName}</strong> Reward: <strong>{activeDayEarned}</strong> / {activeDayPossible} Credits
            </span>
          </div>
        )}
      </header>

      <div className="nav-bar compact-nav-row" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '24px' }}>
        <div className="view-mode-selector" style={{ margin: 0 }}>
          {(['1', '3', '5', '7'] as const).map((mode) => (
            <button
              key={mode}
              className={`selector-btn ${viewMode === mode ? 'active' : ''}`}
              onClick={() => setViewMode(mode)}
              style={{ fontSize: '13px', padding: '6px 12px' }}
            >
              {mode === '1' ? '1 Day' : `${mode} Days`}
            </button>
          ))}
        </div>

        {viewMode !== '7' && schedule.length > 0 && (
          <div className="day-navigator" style={{ margin: 0 }}>
            <button className="nav-arrow-btn" onClick={goToPrevDay}>
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <span className="focused-day-display" style={{ minWidth: '100px', textAlign: 'center', fontWeight: 'bold' }}>
              {focusedDay?.dayName || 'Select Day'}
            </span>
            <button className="nav-arrow-btn" onClick={goToNextDay}>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Link to={`/achievements?userId=${userId}`} className="nav-link" style={{ margin: 0, padding: '8px 16px', borderRadius: '20px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>emoji_events</span>
            Achievements
          </Link>

          {isParentActive && (
            <Link to={`/edit?userId=${userId}`} className="nav-link" style={{ margin: 0, padding: '8px 16px', borderRadius: '20px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>edit</span>
              Edit
            </Link>
          )}
        </div>
      </div>


      <main className={`planner-grid grid-${viewMode}`}>
        {visibleDays.map((day) => {
          const isToday = day.dayName.toLowerCase() === currentDayName.toLowerCase();
          const earned = dayCredits(day);
          const possible = totalPossibleCredits(day);

          return (
            <div key={day.id} className={`day-card ${isToday ? 'today-highlight' : ''}`} id={isToday ? 'today' : day.id}>
              <div className="day-header">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span className="day-name">{day.dayName}</span>
                  {possible > 0 && (
                    <span className="day-credits-badge">
                      ⭐ {earned}/{possible} Credits
                    </span>
                  )}
                </div>
                {isToday && <span className="today-badge">Today</span>}
              </div>

              {['Morning', 'Afternoon', 'Evening'].map((period) => {
                const periodActs = sortActivities(day.activities || [])
                  .filter(a => getPeriod(a) === period);
                
                if (periodActs.length === 0) return null;

                return (
                  <div key={period} className="period-section">
                    <div className={`period-title period-${period}`}>{period}</div>
                    <div className="activity-list">
                      {periodActs.map((act) => (
                        <div key={act.id} className={`activity-item ${act.completed ? 'completed' : ''}`}>
                          <button 
                            className="checkbox-btn"
                            onClick={() => toggleActivity(day.id, act.id, act.completed)}
                          >
                            <span className="material-symbols-outlined">check</span>
                          </button>
                          <div className="activity-content">
                            <div className="activity-main-line">
                              <span className="activity-time">{getDisplayTime(act)}</span>
                              {act.credits ? (
                                <span className="activity-credit-tag">⭐ +{act.credits}</span>
                              ) : null}
                            </div>
                            <span className="activity-text">{getTaskTitle(act.taskId)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </main>

      {userData.goals && userData.goals.length > 0 && (
        <button 
          className="goals-fab" 
          onClick={() => setShowGoals(true)}
          title="View Weekly Goals"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'var(--accent-gradient)',
            color: '#ffffff',
            border: 'none',
            boxShadow: '0 8px 32px var(--accent-glow)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '32px', animation: 'pulse 2s infinite' }}>track_changes</span>
        </button>
      )}

      {showGoals && userData.goals && userData.goals.length > 0 && (
        <div className="login-modal-overlay" onClick={() => setShowGoals(false)}>
          <div 
            className="glass-panel goals-floating-card border-accent animate-fade-in" 
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '400px', width: '90%', padding: '24px', borderRadius: '24px', textAlign: 'left' }}
          >
            <div className="flex justify-between items-center mb-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined text-gradient" style={{ fontSize: '24px' }}>track_changes</span>
                <h3 className="text-gradient" style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Weekly Goals &amp; Habits</h3>
              </div>
              <button 
                onClick={() => setShowGoals(false)} 
                className="btn btn-secondary" 
                style={{ padding: '6px', minWidth: 'auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
              </button>
            </div>
            <div className="goals-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
              {userData.goals.map((goal, i) => (
                <div key={i} className="goal-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)' }}>
                  <span className="material-symbols-outlined text-gradient" style={{ fontSize: '18px' }}>task_alt</span>
                  <span className="goal-text" style={{ color: 'var(--text-main)' }}>{goal}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}


      {showLogin && (
        <Login 
          onSuccess={() => setShowLogin(false)} 
          onCancel={() => setShowLogin(false)} 
        />
      )}
    </div>
  );
};
