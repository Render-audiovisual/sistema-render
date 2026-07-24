import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { getRutaUsuario, getSesion } from "../utils.jsx";
import { ROLES_HOME } from "../constants.js";

export function HomePage() {
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";
  const rutaPropia = getRutaUsuario(sesion?.usuario?.usuario) || "/";

  const atajos = [
    {
      titulo: "Mi tablero",
      desc: "Tu vista de trabajo diaria",
      href: rutaPropia,
    },
    {
      titulo: "Publicaciones",
      desc: "Calendario, planilla y lista operativa en un solo lugar",
      href: "/planificacion-publicaciones",
    },
    {
      titulo: "Mi perfil",
      desc: "Tus datos, foto, usuario y contraseña",
      href: "/perfil",
    },
  ];
  if (esAdmin) {
    atajos.push({
      titulo: "Reporte del equipo",
      desc: "Objetivos, cumplimiento y pendientes por persona",
      href: "/reportes-historias",
    });
    atajos.push({
      titulo: "Tareas",
      desc: "Ver pendientes y cargar una tarea nueva",
      href: "/piezas",
    });
    atajos.push({
      titulo: "Gestión de empleados",
      desc: "Altas, bajas y accesos",
      href: "/empleados",
    });
  }

  return (
    <main aria-label="Render platform home">
      <div className="frame">
        <div className="content">
          <div className="home-hero">
            <h2>Hola, {sesion?.usuario?.nombre} 👋</h2>
            <div className="caption">
              Bienvenido a la plataforma interna de Render. Elegí por dónde
              seguir.
            </div>
          </div>

          <div className="section-label">Accesos rápidos</div>
          <div className="home-shortcuts">
            {atajos.map((atajo) => (
              <a className="home-shortcut" href={atajo.href} key={atajo.href}>
                <div>
                  <div className="hs-title">{atajo.titulo}</div>
                  <div className="hs-desc">{atajo.desc}</div>
                </div>
              </a>
            ))}
          </div>

          {esAdmin && (
            <>
              <div className="section-label">Ir al tablero de cada rol</div>
              <div className="box">
                <div className="home-grid">
                  {ROLES_HOME.map((rol) => (
                    <div className="home-role" key={rol.path}>
                      <div>
                        <div className="home-role-name">{rol.nombre}</div>
                        <div className="caption">{rol.descripcion}</div>
                      </div>
                      <a className="btn" href={rol.path}>
                        Abrir
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
