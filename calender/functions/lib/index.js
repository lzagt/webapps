import admin from "firebase-admin";
import ejs from "ejs";
import path from "path";
import { onRequest } from "firebase-functions/v2/https";
import { fileURLToPath } from "url";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
if (process.env.FUNCTIONS_EMULATOR === "true") {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:5703";
    }
    console.log(`[Functions] Running in emulator mode. Firestore emulator host: ${process.env.FIRESTORE_EMULATOR_HOST}`);
}
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const app = new Hono();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viewsDir = path.join(__dirname, "../views");
async function renderTemplate(viewName, data) {
    const filePath = path.join(viewsDir, `${viewName}.ejs`);
    return new Promise((resolve, reject) => {
        ejs.renderFile(filePath, data, {}, (err, str) => {
            if (err)
                return reject(err);
            resolve(str);
        });
    });
}
function getClientType(c) {
    const clientOverride = c.req.query("client");
    if (clientOverride === "kindle" || clientOverride === "modern") {
        return clientOverride;
    }
    const userAgent = c.req.header("user-agent") || "";
    if (userAgent.includes("Kindle") ||
        userAgent.includes("Silk") ||
        /NetFront/i.test(userAgent)) {
        return "kindle";
    }
    return "modern";
}
// ====================================================
// 1. Gateway Entry Points (with Client Classification)
// ====================================================
// GET /aac/:userId
app.get("/aac/:userId", async (c) => {
    const userId = c.req.param("userId");
    const clientType = getClientType(c);
    if (clientType === "modern") {
        return c.redirect(`/?userId=${userId}`, 302);
    }
    const url = new URL(c.req.url);
    return c.redirect(`/aac/legacy/${userId}${url.search}`, 302);
});
// GET /aac/:userId/edit
app.get("/aac/:userId/edit", async (c) => {
    const userId = c.req.param("userId");
    return c.redirect(`/edit?userId=${userId}`, 302);
});
// GET /aac/:userId/toggle -> redirect legacy
app.get("/aac/:userId/toggle", async (c) => {
    const userId = c.req.param("userId");
    const url = new URL(c.req.url);
    return c.redirect(`/aac/legacy/${userId}/toggle${url.search}`, 302);
});
// ====================================================
// 2. Legacy Kindle View Routes
// ====================================================
// GET /aac/legacy/:userId
app.get("/aac/legacy/:userId", async (c) => {
    const userId = c.req.param("userId");
    const timezone = c.req.query("tz") || "Australia/Sydney";
    const noredirect = c.req.query("noredirect") === "true";
    if (!noredirect) {
        const clientParam = c.req.query("client") ? `&client=${encodeURIComponent(c.req.query("client"))}` : "";
        return c.redirect(`/aac/legacy/${userId}?noredirect=true&tz=${encodeURIComponent(timezone)}${clientParam}#today`, 302);
    }
    try {
        const userDocRef = db.collection("users").doc(userId);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            const html = await renderTemplate("error", {
                title: "Planner Not Found",
                status: 404,
                message: `The planner for user "${userId}" does not exist.`,
                linkUrl: "/",
                linkText: "Go to Portal",
            });
            return c.html(html, 404);
        }
        const userData = userDoc.data() || {};
        const scheduleSnap = await userDocRef.collection("schedule").orderBy("order").get();
        let currentDayName = "";
        try {
            currentDayName = new Date().toLocaleString("en-US", {
                timeZone: timezone,
                weekday: "long",
            });
        }
        catch (e) {
            currentDayName = new Date().toLocaleString("en-US", { weekday: "long" });
        }
        // Helper to format 24h time to 12h AM/PM
        const formatTime = (time24) => {
            if (!time24)
                return '';
            const parts = time24.split(':');
            if (parts.length < 2)
                return time24;
            const h = parseInt(parts[0], 10);
            const mStr = parts[1];
            const ampm = h >= 12 ? 'PM' : 'AM';
            const displayH = h % 12 || 12;
            return `${displayH}:${mStr} ${ampm}`;
        };
        const schedule = [];
        scheduleSnap.forEach((doc) => {
            const dayData = doc.data() || {};
            const rawActivities = dayData.activities || [];
            const mappedActivities = rawActivities.map((act) => {
                const task = (userData.tasks || []).find((t) => t.id === act.taskId);
                const description = task ? task.title : "(Deleted Task)";
                let period = "Morning";
                if (act.startTime) {
                    const hour = parseInt(act.startTime.split(":")[0], 10);
                    if (hour < 12)
                        period = "Morning";
                    else if (hour < 17)
                        period = "Afternoon";
                    else
                        period = "Evening";
                }
                const timeStr = act.endTime
                    ? `${formatTime(act.startTime)} - ${formatTime(act.endTime)}`
                    : formatTime(act.startTime);
                return {
                    ...act,
                    description,
                    period,
                    time: timeStr
                };
            }).sort((a, b) => {
                if (a.startTime && b.startTime)
                    return a.startTime.localeCompare(b.startTime);
                return 0;
            });
            schedule.push({
                id: doc.id,
                ...dayData,
                activities: mappedActivities
            });
        });
        const html = await renderTemplate("kindle", {
            userData,
            schedule,
            currentDayName,
            userId,
            timezone,
        });
        return c.html(html);
    }
    catch (error) {
        console.error("Error fetching calendar:", error);
        const html = await renderTemplate("error", {
            title: "Internal Server Error",
            status: 500,
            message: `An error occurred while fetching the calendar: ${error.message}`,
        });
        return c.html(html, 500);
    }
});
// GET /aac/legacy/:userId/toggle
app.get("/aac/legacy/:userId/toggle", async (c) => {
    const userId = c.req.param("userId");
    const day = c.req.query("day");
    const itemId = c.req.query("itemId");
    const completed = c.req.query("completed");
    const tz = c.req.query("tz");
    const client = c.req.query("client");
    if (!day || !itemId) {
        return c.text("Bad Request: Missing day or itemId parameters.", 400);
    }
    try {
        const dayDocRef = db.collection("users").doc(userId).collection("schedule").doc(day);
        const dayDoc = await dayDocRef.get();
        if (!dayDoc.exists) {
            return c.text("Day document not found.", 404);
        }
        const dayData = dayDoc.data() || {};
        const activities = dayData.activities || [];
        const isCompleted = completed === "true";
        const updatedActivities = activities.map((act) => {
            if (act.id === itemId) {
                return { ...act, completed: isCompleted };
            }
            return act;
        });
        await dayDocRef.update({ activities: updatedActivities });
        const userDocRef = db.collection("users").doc(userId);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data() || {};
        const tasks = userData.tasks || [];
        const activity = activities.find((act) => act.id === itemId);
        const timezone = tz || "Australia/Sydney";
        let dateStr = new Date().toISOString().split("T")[0];
        let checkInMinutes = 0;
        try {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }).formatToParts(new Date());
            const year = parts.find(p => p.type === "year")?.value;
            const month = parts.find(p => p.type === "month")?.value;
            const dayVal = parts.find(p => p.type === "day")?.value;
            const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
            const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);
            dateStr = `${year}-${month}-${dayVal}`;
            checkInMinutes = hour * 60 + minute;
        }
        catch (e) {
            console.warn("Timezone calculation failed, using UTC fallback", e);
            const now = new Date();
            checkInMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        }
        const achievementId = `${dateStr}_${itemId}`;
        const achievementDocRef = db.collection("users").doc(userId).collection("achievements").doc(achievementId);
        if (isCompleted) {
            if (activity) {
                const task = tasks.find((t) => t.id === activity.taskId);
                const taskTitle = task ? task.title : "Unknown Task";
                const credits = activity.credits || 0;
                let lagStatus = "On-Time";
                if (activity.endTime) {
                    const [endHour, endMin] = activity.endTime.split(":").map(Number);
                    const endMinutes = endHour * 60 + endMin;
                    const lag = checkInMinutes - endMinutes;
                    if (lag <= 0) {
                        lagStatus = "On-Time";
                    }
                    else if (lag <= 15) {
                        lagStatus = "A bit late";
                    }
                    else {
                        lagStatus = "Late";
                    }
                }
                await achievementDocRef.set({
                    id: achievementId,
                    activityId: itemId,
                    taskId: activity.taskId,
                    taskTitle,
                    credits,
                    completedAt: new Date(),
                    date: dateStr,
                    dayId: day,
                    status: "pending",
                    lagStatus
                });
            }
        }
        else {
            await achievementDocRef.delete();
        }
        const timezoneParam = tz ? `&tz=${encodeURIComponent(tz)}` : "";
        const clientParam = client ? `&client=${encodeURIComponent(client)}` : "";
        return c.redirect(`/aac/legacy/${userId}?noredirect=true${timezoneParam}${clientParam}#${day}`, 302);
    }
    catch (error) {
        console.error("Error toggling calendar item:", error);
        return c.text("Error saving status: " + error.message, 500);
    }
});
// GET /aac/legacy/:userId/edit
app.get("/aac/legacy/:userId/edit", async (c) => {
    const userId = c.req.param("userId");
    return c.redirect(`/edit?userId=${userId}`, 302);
});
// ====================================================
// 3. Firebase Cloud Function V2 Export
// ====================================================
export const api = onRequest({
    region: "australia-southeast1",
    memory: "256MiB",
    minInstances: 0,
    maxInstances: 2,
    concurrency: 80,
}, getRequestListener(app.fetch));
