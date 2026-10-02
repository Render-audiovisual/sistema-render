import React from "react";
import "./QuickHome.css";

const WORK_AREAS = [
  { href: "/workspace/tareas", icon: "✓", title: "Tareas", description: "Abrí el tablero y continuá el trabajo del equipo." },
  { href: "/lista", icon: "☷", title: "Mi lista", description: "Organizá tus pendientes privados sin cargar el tablero." },
  { href: "/moodboards", icon: "▧", title: "Moodboard", description: "Consultá referencias visuales por cliente." },
  { href: "/feedback", icon: "◌", title: "Feedback", description: "Revisá notas del equipo y de los clientes." },
  { href: "/planificacion-publicaciones", icon: "◫", title: "Publicaciones", description: "Planificá el contenido que se va a publicar." },
];

export function QuickHomePage({ sesion, onNavigate }) {
  const firstName = String(sesion?.usuario?.nombre || "equipo").trim().split(/\s+/)[0];
  const open = (event, href) => {
    if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  };

  return <main className="quick-home" aria-label="Inicio rápido de Render">
    <section className="quick-home-shell">
      <header className="quick-home-header">
        <span>Inicio rápido</span>
        <h1>Hola, {firstName}.</h1>
        <p>Elegí dónde trabajar. Esta pantalla no carga tareas ni reportes para que Render abra al instante.</p>
      </header>

      <nav className="quick-home-grid" aria-label="Áreas de trabajo">
        {WORK_AREAS.map((area) => <a href={area.href} key={area.href} onClick={(event) => open(event, area.href)}>
          <span aria-hidden="true">{area.icon}</span>
          <div><strong>{area.title}</strong><small>{area.description}</small></div>
          <b aria-hidden="true">→</b>
        </a>)}
      </nav>

      <footer className="quick-home-note">
        <span>Ligero</span>
        <p>Los datos se cargan recién cuando entrás a una sección.</p>
      </footer>
    </section>
  </main>;
}
