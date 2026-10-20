import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('./Empleados.jsx', import.meta.url), 'utf8');

test('notification copy separates notices from configured login identities', () => {
  assert.match(source, /<span>Correo para notificaciones<\/span>/);
  assert.match(source, /Solo para avisos, no para iniciar sesión/);
  assert.match(source, /Ingresá con el usuario de acceso o el email de Google configurado explícitamente por un administrador/);
  assert.match(source, /El correo de avisos no habilita el acceso con Google ni con contraseña/);
});

test('Google editor initializes only from configured Google email or empty', () => {
  const initializer = source.match(/const iniciarEdicionGoogleEmail = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(initializer, 'Google editor initializer exists');
  assert.match(initializer[1], /setGoogleEmailEdicion\(usuarioAdministrado\?\.google_email \|\| ""\);/);
  assert.doesNotMatch(initializer[1], /email_notificaciones|setCorreoEdicion|fetch\(/);
  const assignments = [...source.matchAll(/setGoogleEmailEdicion\(([^;]*)\);/g)];
  assert.ok(assignments.length > 0);
  for (const [, value] of assignments) assert.doesNotMatch(value, /email_notificaciones|correoEdicion|emailNotificaciones/);
});

test('Google access remains explicitly configured and saved by the existing action', () => {
  assert.match(source, /Email de acceso configurado explícitamente por un administrador/);
  assert.match(source, /<span>Email de Google para acceso<\/span>/);
  assert.match(source, /onChange=\{\(e\) => setGoogleEmailEdicion\(e\.target\.value\)\}/);
  assert.match(source, /onClick=\{\(\) => guardarGoogleEmail\(usuarioAdministrado\)\}/);
  const file = ts.createSourceFile('Empleados.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let save;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'guardarGoogleEmail') save = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(ts.isArrowFunction(save));
  assert.ok(ts.isCallExpression(save.body));
  assert.equal(save.body.expression.getText(file), 'runMutation');
  const fields = new Map(save.body.arguments[0].properties.map(property => [property.name.getText(file), property.initializer]));
  assert.equal(fields.get('path').getText(file), '`/api/usuarios/${u.id}/google-email`');
  const body = fields.get('body');
  assert.ok(ts.isObjectLiteralExpression(body));
  assert.equal(body.properties.length, 1);
  assert.equal(body.properties[0].name.getText(file), 'google_email');
  assert.equal(body.properties[0].initializer.getText(file), 'googleEmailEdicion');
  assert.match(source, /body:JSON\.stringify\(body\)/);
  assert.match(source, /disabled=\{guardandoGoogleEmail\}/);
});
