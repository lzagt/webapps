export interface AATask {
  id: string;
  title: string;
}

export interface UserSettings {
  parentId: string;
  pin: string;
}

export interface UserMetadata {
  title: string;
  subtitle: string;
  settings: UserSettings;
  tasks: AATask[];
  goals: string[];
}

export interface Activity {
  id: string;
  taskId: string;
  completed: boolean;
  startTime?: string;
  endTime?: string;
  credits?: number;
}

export interface DaySchedule {
  id: string;
  dayName: string;
  order: number;
  activities: Activity[];
}

export interface Achievement {
  id: string;
  activityId: string;
  taskId: string;
  taskTitle: string;
  credits: number;
  completedAt: any; // Firestore Timestamp
  approvedAt?: any; // Firestore Timestamp
  date: string;
  dayId: string;
  status: 'pending' | 'approved';
  lagStatus: 'On-Time' | 'A bit late' | 'Late';
}

