import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signInWithEmailAndPassword, signOut, updatePassword, verifyBeforeUpdateEmail } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const $ = (selector) => document.querySelector(selector);
const authView = $("#auth-view");
const appView = $("#app-view");
const loginForm = $("#login-form");
const authError = $("#auth-error");
const dataMessage = $("#data-message");
const tasksList = $("#tasks-list");
const taskDialog = $("#task-dialog");
const projectDialog = $("#project-dialog");
const taskForm = $("#task-form");
const projectForm = $("#project-form");

let currentUser = null;
let tasks = [];
let projects = [];
let unsubscribeTasks = null;
let unsubscribeProjects = null;
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let installPrompt = null;

const priorityLabels = { high: "Высокий", medium: "Средний", low: "Низкий" };
const statusLabels = { todo: "К выполнению", pending: "К выполнению", "to-do": "К выполнению", "in-progress": "В работе", in_progress: "В работе", completed: "Завершено", done: "Завершено" };

function authMessage(error) {
  return ({
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/invalid-email": "Проверьте правильность email.",
    "auth/too-many-requests": "Слишком много попыток. Попробуйте позже.",
    "auth/network-request-failed": "Нет соединения с интернетом.",
    "auth/unauthorized-domain": "Домен сайта не разрешён в Firebase Authentication."
  })[error.code] || "Не удалось войти. Проверьте данные и повторите попытку.";
}

function setError(element, message = "") { element.textContent = message; element.hidden = !message; }
function setAccountMessage(message = "", error = false) { const element = $("#account-form-message"); element.textContent = message; element.hidden = !message; element.classList.toggle("error", error); }
function setDataMessage(message = "", error = false) { dataMessage.textContent = message; dataMessage.hidden = !message; dataMessage.classList.toggle("error", error); }
function projectById(id) { return projects.find((project) => project.id === id); }
function normalizeStatus(status, completed) { if (completed || ["done", "completed"].includes(status)) return "completed"; if (["in-progress", "in_progress"].includes(status)) return "in-progress"; return "todo"; }
function cleanTaskTitle(title) { return String(title || "Без названия").replace(/\s*(?:[—–-]\s*)?\(?копия(?:\s*\d+)?\)?\s*$/iu, "").trim() || "Без названия"; }

function dateFromValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(value) {
  const date = dateFromValue(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  const date = dateFromValue(value);
  return date ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(date) : "Без срока";
}

function isHoliday(date) {
  const fixedHolidays = new Set([
    "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
    "02-23", "03-08", "05-01", "05-09", "06-12", "11-04"
  ]);
  const monthDay = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return date.getDay() === 0 || date.getDay() === 6 || fixedHolidays.has(monthDay);
}

function showAuth() {
  currentUser = null;
  unsubscribeTasks?.(); unsubscribeProjects?.();
  authView.hidden = false; appView.hidden = true;
  loginForm.reset(); $("#login-button").disabled = false; $("#login-button").textContent = "Войти";
}

function showApp() { authView.hidden = true; appView.hidden = false; }

async function loadProfile(user) {
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    const profile = snapshot.exists() ? snapshot.data() : {};
    const name = profile.displayName || user.displayName || user.email?.split("@")[0] || "пользователь";
    $("#greeting").textContent = `Здравствуйте, ${name}!`;
  } catch { $("#greeting").textContent = "Здравствуйте!"; }
  $("#user-email").textContent = user.email || "";
}

function subscribeToData(user) {
  setDataMessage("Загружаем ваши планы…");
  unsubscribeProjects = onSnapshot(collection(db, "users", user.uid, "projects"), (snapshot) => {
    projects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => !item.archived);
    projects.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
    updateProjectOptions(); renderAll();
  }, () => setDataMessage("Не удалось загрузить проекты из Firestore.", true));

  unsubscribeTasks = onSnapshot(collection(db, "users", user.uid, "tasks"), (snapshot) => {
    tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    tasks.sort((a, b) => (dateFromValue(a.dueDate)?.getTime() || Infinity) - (dateFromValue(b.dueDate)?.getTime() || Infinity));
    setDataMessage(""); renderAll();
  }, () => setDataMessage("Не удалось загрузить задачи. Проверьте правила Firestore и соединение.", true));
}

function updateProjectOptions() {
  for (const select of [$("#project-filter"), $("#task-project")]) {
    const previous = select.value;
    const first = select.id === "project-filter" ? "Все проекты" : "Без проекта";
    select.replaceChildren(new Option(first, ""));
    projects.forEach((project) => select.add(new Option(project.name || "Без названия", project.id)));
    select.value = previous;
  }
}

function filteredTasks() {
  const search = $("#search-input").value.trim().toLocaleLowerCase("ru");
  const project = $("#project-filter").value;
  const status = $("#status-filter").value;
  return tasks.filter((task) => {
    const projectName = projectById(task.projectId)?.name || "без проекта";
    const normalizedStatus = normalizeStatus(task.status, task.completed);
    const searchableText = [task.title, task.description, projectName, priorityLabels[task.priority], statusLabels[normalizedStatus]].filter(Boolean).join(" ").toLocaleLowerCase("ru");
    const matchesText = !search || searchableText.includes(search);
    return matchesText && (!project || task.projectId === project) && (!status || normalizedStatus === status);
  });
}

function renderAll() {
  const completed = tasks.filter((task) => normalizeStatus(task.status, task.completed) === "completed").length;
  $("#welcome-summary").textContent = tasks.length ? `Всего задач: ${tasks.length}. Выполнено: ${completed}. Запланируйте следующий шаг.` : "Создайте первую задачу и начните планировать месяц.";
  renderTasks(); renderCalendar();
}

function createPill(text, className) { const span = document.createElement("span"); span.className = className; span.textContent = text; return span; }
function iconButton(label, symbol, handler) { const button = document.createElement("button"); button.type = "button"; button.className = "icon-button"; button.ariaLabel = label; button.title = label; button.textContent = symbol; button.addEventListener("click", handler); return button; }

function renderTasks() {
  const visible = filteredTasks(); tasksList.replaceChildren();
  $("#tasks-count").textContent = `${visible.length}`;
  if (!visible.length) { const empty = document.createElement("div"); empty.className = "empty-state"; empty.textContent = tasks.length ? "По выбранным фильтрам задач нет." : "Задач пока нет. Создайте первую задачу."; tasksList.append(empty); return; }

  visible.forEach((task) => {
    const status = normalizeStatus(task.status, task.completed);
    const row = document.createElement("article"); row.className = `task-row${status === "completed" ? " done" : ""}`;
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.className = "task-check"; checkbox.checked = status === "completed"; checkbox.ariaLabel = `Отметить задачу «${task.title || "Без названия"}» выполненной`;
    checkbox.addEventListener("change", () => toggleTask(task, checkbox.checked));
    const copy = document.createElement("div"); const title = document.createElement("h3"); title.className = "task-title"; title.textContent = cleanTaskTitle(task.title);
    const description = document.createElement("p"); description.className = "task-description"; description.textContent = task.description || "Описание не добавлено"; copy.append(title, description);
    const project = projectById(task.projectId); const projectPill = createPill(project?.name || "Без проекта", "project-pill"); if (project?.color) projectPill.style.borderLeft = `3px solid ${project.color}`;
    const priority = task.priority || "medium"; const priorityPill = createPill(priorityLabels[priority] || priority, `priority-pill priority-${priority}`);
    const statusPill = createPill(statusLabels[status], "status-pill"); const due = document.createElement("span"); due.className = "task-date"; due.textContent = formatDate(task.dueDate);
    const actions = document.createElement("div"); actions.className = "row-actions"; actions.append(iconButton("Дублировать", "⧉", () => duplicateTask(task)), iconButton("Редактировать", "✎", () => openTaskDialog(task)), iconButton("Удалить", "×", () => removeTask(task)));
    row.append(checkbox, copy, projectPill, priorityPill, statusPill, due, actions); tasksList.append(row);
  });
}

function renderCalendar() {
  $("#calendar-title").textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(calendarCursor);
  const grid = $("#calendar-grid"); grid.replaceChildren();
  const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(first.getDate() - mondayOffset);
  const today = dateKey(new Date());
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start); date.setDate(start.getDate() + index); const key = dateKey(date);
    const cell = document.createElement("div"); cell.className = `calendar-day${date.getMonth() !== calendarCursor.getMonth() ? " outside" : ""}${key === today ? " today" : ""}${isHoliday(date) ? " holiday" : " weekday"}`;
    const number = document.createElement("button"); number.type = "button"; number.className = "day-number"; number.textContent = date.getDate(); number.title = "Создать задачу на эту дату"; number.ariaLabel = `Создать задачу на ${formatDate(key)}`; number.addEventListener("click", () => openTaskDialog(null, key)); cell.append(number);
    const dayTasks = tasks.filter((task) => dateKey(task.dueDate) === key);
    dayTasks.slice(0, 3).forEach((task) => { const button = document.createElement("button"); button.type = "button"; button.className = `calendar-task${normalizeStatus(task.status, task.completed) === "completed" ? " done" : ""}`; button.textContent = cleanTaskTitle(task.title); button.style.borderLeftColor = projectById(task.projectId)?.color || "#e9548d"; button.addEventListener("click", () => openTaskDialog(task)); cell.append(button); });
    if (dayTasks.length > 3) { const more = document.createElement("span"); more.className = "calendar-more"; more.textContent = `Ещё ${dayTasks.length - 3}`; cell.append(more); }
    cell.addEventListener("dblclick", (event) => { if (event.target === cell) openTaskDialog(null, key); }); grid.append(cell);
  }
}

function openTaskDialog(task = null, dueDate = "") {
  taskForm.reset(); setError($("#task-form-error"));
  $("#task-dialog-title").textContent = task ? "Редактировать задачу" : "Новая задача";
  $("#task-id").value = task?.id || ""; $("#task-title").value = task ? cleanTaskTitle(task.title) : ""; $("#task-description").value = task?.description || "";
  $("#task-project").value = task?.projectId || ""; $("#task-due-date").value = task ? dateKey(task.dueDate) : dueDate; $("#task-priority").value = task?.priority || "medium";
  $("#task-status").value = normalizeStatus(task?.status, task?.completed); $("#task-minutes").value = task?.estimatedMinutes ?? "";
  taskDialog.showModal(); setTimeout(() => $("#task-title").focus(), 0);
}

async function saveTask(event) {
  event.preventDefault(); if (!taskForm.reportValidity() || !currentUser) return;
  const button = $("#save-task-button"); button.disabled = true; setError($("#task-form-error"));
  const status = $("#task-status").value; const dueDate = $("#task-due-date").value;
  const payload = { title: $("#task-title").value.trim(), description: $("#task-description").value.trim(), projectId: $("#task-project").value || null, dueDate: dueDate || null, priority: $("#task-priority").value, status, completed: status === "completed", estimatedMinutes: $("#task-minutes").value === "" ? null : Number($("#task-minutes").value), updatedAt: serverTimestamp() };
  try { const id = $("#task-id").value; if (id) await updateDoc(doc(db, "users", currentUser.uid, "tasks", id), payload); else await addDoc(collection(db, "users", currentUser.uid, "tasks"), { ...payload, createdAt: serverTimestamp() }); taskDialog.close(); }
  catch (error) { console.error(error); setError($("#task-form-error"), "Не удалось сохранить задачу. Проверьте соединение и правила Firestore."); }
  finally { button.disabled = false; }
}

async function toggleTask(task, completed) { try { await updateDoc(doc(db, "users", currentUser.uid, "tasks", task.id), { completed, status: completed ? "completed" : "todo", updatedAt: serverTimestamp() }); } catch { setDataMessage("Не удалось изменить задачу.", true); } }
async function duplicateTask(task) {
  if (!currentUser) return;
  try {
    const { id, createdAt, updatedAt, ...taskData } = task;
    await addDoc(collection(db, "users", currentUser.uid, "tasks"), {
      ...taskData,
      title: cleanTaskTitle(task.title),
      completed: false,
      status: "todo",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    setDataMessage("Копия задачи создана.");
    setTimeout(() => setDataMessage(""), 2200);
  } catch {
    setDataMessage("Не удалось дублировать задачу.", true);
  }
}
async function removeTask(task) { if (!confirm(`Удалить задачу «${task.title || "Без названия"}»?`)) return; try { await deleteDoc(doc(db, "users", currentUser.uid, "tasks", task.id)); } catch { setDataMessage("Не удалось удалить задачу.", true); } }

async function saveProject(event) {
  event.preventDefault(); if (!projectForm.reportValidity() || !currentUser) return; const button = $("#save-project-button"); button.disabled = true; setError($("#project-form-error"));
  try { await addDoc(collection(db, "users", currentUser.uid, "projects"), { name: $("#project-name").value.trim(), color: $("#project-color").value, icon: "folder", archived: false, createdAt: serverTimestamp() }); projectDialog.close(); }
  catch { setError($("#project-form-error"), "Не удалось создать проект."); } finally { button.disabled = false; }
}

async function saveAccount(event) {
  event.preventDefault();
  if (!currentUser || !currentUser.email || !$("#account-form").reportValidity()) return;
  const currentPassword = $("#current-password").value;
  const newEmail = $("#new-email").value.trim();
  const newPassword = $("#new-password").value;
  if (!newEmail && !newPassword) { setAccountMessage("Укажите новый email или новый пароль.", true); return; }

  const button = $("#save-account-button"); button.disabled = true; setAccountMessage();
  try {
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    if (newPassword) await updatePassword(currentUser, newPassword);
    if (newEmail && newEmail !== currentUser.email) {
      await verifyBeforeUpdateEmail(currentUser, newEmail);
      setAccountMessage(`${newPassword ? "Пароль обновлён. " : ""}На новый email отправлена ссылка подтверждения.`);
    } else {
      setAccountMessage("Пароль успешно обновлён.");
    }
    $("#current-password").value = "";
    $("#new-password").value = "";
  } catch (error) {
    const messages = {
      "auth/invalid-credential": "Текущий пароль указан неверно.",
      "auth/wrong-password": "Текущий пароль указан неверно.",
      "auth/email-already-in-use": "Этот email уже используется другим аккаунтом.",
      "auth/invalid-email": "Новый email указан неверно.",
      "auth/weak-password": "Новый пароль должен содержать не менее 6 символов.",
      "auth/network-request-failed": "Нет соединения с интернетом."
    };
    setAccountMessage(messages[error.code] || "Не удалось изменить учётные данные. Повторите попытку.", true);
  } finally { button.disabled = false; }
}

loginForm.addEventListener("submit", async (event) => { event.preventDefault(); setError(authError); if (!loginForm.reportValidity()) return; const button = $("#login-button"); button.disabled = true; button.textContent = "Входим…"; try { await signInWithEmailAndPassword(auth, loginForm.elements.email.value.trim(), loginForm.elements.password.value); } catch (error) { setError(authError, authMessage(error)); button.disabled = false; button.textContent = "Войти"; } });
$("#logout-button").addEventListener("click", () => signOut(auth)); taskForm.addEventListener("submit", saveTask); projectForm.addEventListener("submit", saveProject); $("#account-form").addEventListener("submit", saveAccount);
$("#account-button").addEventListener("click", () => { $("#account-form").reset(); setAccountMessage(); $("#account-dialog").showModal(); });
$("#install-button").addEventListener("click", async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("#install-button").hidden = true; });
[$("#new-task-button"), $("#welcome-new-task")].forEach((button) => button.addEventListener("click", () => openTaskDialog()));
$("#new-project-button").addEventListener("click", () => { projectForm.reset(); $("#project-color").value = "#ef6a9a"; setError($("#project-form-error")); projectDialog.showModal(); });
document.querySelectorAll(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active")); button.classList.add("active"); $("#tasks-view").hidden = button.dataset.view !== "tasks"; $("#calendar-view").hidden = button.dataset.view !== "calendar"; appView.classList.remove("menu-open"); }));
$("#menu-button").addEventListener("click", () => appView.classList.toggle("menu-open"));
[$("#search-input"), $("#project-filter"), $("#status-filter")].forEach((element) => element.addEventListener(element.tagName === "INPUT" ? "input" : "change", renderTasks));
$("#calendar-prev").addEventListener("click", () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); renderCalendar(); });
$("#calendar-next").addEventListener("click", () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); renderCalendar(); });
$("#calendar-today").addEventListener("click", () => { calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); });

onAuthStateChanged(auth, (user) => { if (!user) { showAuth(); return; } currentUser = user; showApp(); loadProfile(user); subscribeToData(user); }, (error) => { showAuth(); setError(authError, authMessage(error)); });

window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; $("#install-button").hidden = false; });
window.addEventListener("appinstalled", () => { installPrompt = null; $("#install-button").hidden = true; });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch((error) => console.error("Не удалось зарегистрировать service worker:", error)));
