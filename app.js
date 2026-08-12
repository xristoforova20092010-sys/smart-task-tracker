import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const authError = document.querySelector("#auth-error");
const logoutButton = document.querySelector("#logout-button");
const greeting = document.querySelector("#greeting");
const dataMessage = document.querySelector("#data-message");
const tasksList = document.querySelector("#tasks-list");

const priorityLabels = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий"
};

const statusLabels = {
  todo: "К выполнению",
  "to-do": "К выполнению",
  pending: "К выполнению",
  "in-progress": "В работе",
  in_progress: "В работе",
  done: "Завершено",
  completed: "Завершено"
};

function friendlyAuthError(error) {
  const messages = {
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/user-not-found": "Пользователь с таким email не найден.",
    "auth/wrong-password": "Неверный пароль.",
    "auth/invalid-email": "Проверьте правильность email.",
    "auth/missing-password": "Введите пароль.",
    "auth/too-many-requests": "Слишком много попыток входа. Попробуйте позже.",
    "auth/network-request-failed": "Нет соединения с интернетом. Проверьте сеть и повторите попытку.",
    "auth/operation-not-allowed": "Вход по email и паролю не включён в Firebase Authentication.",
    "auth/unauthorized-domain": "Домен сайта не разрешён в настройках Firebase Authentication.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase API key неверен или ограничен для этого сайта."
  };

  return messages[error.code] || "Не удалось войти. Проверьте данные и попробуйте ещё раз.";
}

function setAuthError(message = "") {
  authError.textContent = message;
  authError.hidden = !message;
}

function setDataMessage(message, isError = false) {
  dataMessage.textContent = message;
  dataMessage.hidden = !message;
  dataMessage.classList.toggle("error", isError);
}

function showAuth() {
  authView.hidden = false;
  appView.hidden = true;
  tasksList.replaceChildren();
  loginForm.reset();
  loginButton.disabled = false;
  loginButton.textContent = "Войти";
}

function showApp() {
  authView.hidden = true;
  appView.hidden = false;
}

function formatLabel(value, labels) {
  if (!value) return "Не указано";
  const key = String(value).toLowerCase();
  return labels[key] || String(value);
}

function formatDate(value) {
  if (!value) return "Не указан";

  let date;
  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else if (typeof value === "object" && typeof value.seconds === "number") {
    date = new Date(value.seconds * 1000);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return "Не указан";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function addDetail(list, label, value, className = "") {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  if (className) description.className = className;
  wrapper.append(term, description);
  list.append(wrapper);
}

function renderTasks(tasks, projects) {
  tasksList.replaceChildren();

  for (const task of tasks) {
    const card = document.createElement("article");
    card.className = `task-card${task.completed ? " completed" : ""}`;

    const title = document.createElement("h2");
    title.textContent = task.title || "Без названия";

    const description = document.createElement("p");
    description.className = "task-description";
    description.textContent = task.description || "Описание не добавлено";

    const details = document.createElement("dl");
    details.className = "task-details";
    addDetail(details, "Проект", projects.get(task.projectId) || "Без проекта");
    addDetail(details, "Приоритет", formatLabel(task.priority, priorityLabels));
    addDetail(details, "Статус", formatLabel(task.status, statusLabels));
    addDetail(details, "Время", task.estimatedMinutes != null ? `${task.estimatedMinutes} мин.` : "Не указано");
    addDetail(details, "Срок", formatDate(task.dueDate));
    addDetail(details, "Выполнено", task.completed ? "Да" : "Нет", task.completed ? "completion" : "");

    card.append(title, description, details);
    tasksList.append(card);
  }
}

async function loadUserData(user) {
  setDataMessage("Загружаем задачи…");
  tasksList.replaceChildren();

  try {
    const userRef = doc(db, "users", user.uid);
    const projectsRef = collection(db, "users", user.uid, "projects");
    const tasksRef = collection(db, "users", user.uid, "tasks");
    const [profileSnapshot, projectsSnapshot, tasksSnapshot] = await Promise.all([
      getDoc(userRef),
      getDocs(projectsRef),
      getDocs(tasksRef)
    ]);

    const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
    const displayName = profile.displayName || user.displayName || user.email?.split("@")[0] || "пользователь";
    greeting.textContent = `Здравствуйте, ${displayName}!`;

    const projects = new Map();
    projectsSnapshot.forEach((projectDoc) => {
      projects.set(projectDoc.id, projectDoc.data().name || "Без названия");
    });

    const tasks = tasksSnapshot.docs.map((taskDoc) => ({
      id: taskDoc.id,
      ...taskDoc.data()
    }));

    if (tasks.length === 0) {
      setDataMessage("У вас пока нет задач.");
      return;
    }

    renderTasks(tasks, projects);
    setDataMessage("");
  } catch (error) {
    console.error("Не удалось загрузить данные Firestore:", error);
    const isOffline = !navigator.onLine || error.code === "unavailable" || error.code === "firestore/unavailable";
    setDataMessage(
      isOffline
        ? "Нет соединения с интернетом. Проверьте сеть и обновите страницу."
        : "Не удалось получить данные из базы. Попробуйте обновить страницу позже.",
      true
    );
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthError();

  if (!loginForm.reportValidity()) return;

  const email = loginForm.elements.email.value.trim();
  const password = loginForm.elements.password.value;
  loginButton.disabled = true;
  loginButton.textContent = "Входим…";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setAuthError(friendlyAuthError(error));
    loginButton.disabled = false;
    loginButton.textContent = "Войти";
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Не удалось выйти:", error);
    setDataMessage("Не удалось завершить сеанс. Проверьте соединение и повторите попытку.", true);
  } finally {
    logoutButton.disabled = false;
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    showApp();
    loadUserData(user);
  } else {
    showAuth();
  }
}, (error) => {
  console.error("Ошибка инициализации Firebase Authentication:", error);
  showAuth();
  setAuthError(friendlyAuthError(error));
});
