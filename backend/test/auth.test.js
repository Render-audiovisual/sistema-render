import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { crearAutenticador, requiereRoles } from "../src/auth.js";

function crearRespuesta() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function crearRequest(authorization) {
  return {
    usuario: null,
    get(nombre) {
      return nombre.toLowerCase() === "authorization" ? authorization : "";
    },
  };
}

test("rechaza llamadas sin bearer token", () => {
  const req = crearRequest("");
  const res = crearRespuesta();
  let continuo = false;

  crearAutenticador("secreto-de-prueba")(req, res, () => {
    continuo = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(continuo, false);
});

test("acepta un JWT válido y expone su identidad", () => {
  const secret = "secreto-de-prueba";
  const token = jwt.sign({ id: 7, usuario: "oriana", rol: "community" }, secret);
  const req = crearRequest(`Bearer ${token}`);
  const res = crearRespuesta();
  let continuo = false;

  crearAutenticador(secret)(req, res, () => {
    continuo = true;
  });

  assert.equal(continuo, true);
  assert.equal(req.usuario.id, 7);
  assert.equal(req.usuario.rol, "community");
});

test("rechaza JWT inválido y configuración sin secreto", () => {
  const reqInvalido = crearRequest("Bearer token-invalido");
  const resInvalido = crearRespuesta();
  crearAutenticador("secreto-de-prueba")(reqInvalido, resInvalido, () => {});
  assert.equal(resInvalido.statusCode, 401);

  const reqSinSecret = crearRequest("Bearer cualquier-token");
  const resSinSecret = crearRespuesta();
  crearAutenticador("")(reqSinSecret, resSinSecret, () => {});
  assert.equal(resSinSecret.statusCode, 503);
});

test("aplica autorización por rol después de autenticar", () => {
  const middleware = requiereRoles("admin");

  const reqAdmin = { usuario: { rol: "admin" } };
  const resAdmin = crearRespuesta();
  let adminContinuo = false;
  middleware(reqAdmin, resAdmin, () => {
    adminContinuo = true;
  });
  assert.equal(adminContinuo, true);

  const reqCommunity = { usuario: { rol: "community" } };
  const resCommunity = crearRespuesta();
  middleware(reqCommunity, resCommunity, () => {});
  assert.equal(resCommunity.statusCode, 403);
});
