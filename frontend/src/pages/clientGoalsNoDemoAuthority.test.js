import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Source and extracted callback contracts, not mounted/browser authorization proof.
const source=readFileSync(new URL('./ClientesObjetivos.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('ClientesObjetivos.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk)}walk(root);return result;}
const variable=name=>{const found=nodes(tree,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)===name);assert.equal(found.length,1);return found[0].initializer;};
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));

test('canonical goals has no environment/username demo authority or publication-isolation promise',()=>{
 assert.equal(tree.parseDiagnostics.length,0);
 assert.equal(nodes(tree,node=>ts.isIdentifier(node)&&node.text==='isDemo').length,0);
 assert.doesNotMatch(source,/localhost|127\.0\.0\.1|\[::1\]|import\.meta\.env|NODE_ENV|location\.(?:hostname|host)\b/);
 const literals=nodes(tree,node=>ts.isStringLiteralLike(node)||ts.isJsxText(node)).map(node=>node.getText(tree)).join('\n');
 assert.doesNotMatch(literals,/\bdemo\b|entorno de prueba|modo de prueba|no afecta(?:n|rá)? (?:a )?(?:las )?publicaciones|sin afectar (?:a )?(?:las )?publicaciones/i);
 const gate=variable('canManage').getText(tree);
 assert.doesNotMatch(gate,/usuario|nombre|hostname|location/);
 for(const [role,allowed] of [['admin',true],['community',true],['diseno',false],['edicion',false],['produccion',false],['administracion',false],['unknown',false]])
  assert.equal(evaluate(variable('canManage'),{view:{role}}),allowed,role);
});

test('actual preparation opening retains role/current observation/loaded/quota gates',()=>{
 for(const allowed of [false,true]){
  const actions=[],deps={capture:()=>({current:()=>true}),loaded:{current:true},modalOpen:{current:false},canManage:allowed,historic:false,
   client:{cuota_desactualizada:false,preparacion_revision:'a'.repeat(64)},validGoalQuotaRevision:value=>value==='a'.repeat(64),total:2,setPreparing:value=>actions.push(value)};
  evaluate(variable('openPreparation'),deps)();assert.deepEqual(actions,allowed?[true]:[]);
 }
 const gate=variable('canReviewQuota').getText(tree);
 assert.match(gate,/view\.role === 'admin'/);assert.doesNotMatch(gate,/usuario|hostname|isDemo/);
});

test('actual normal preparation dispatches canonical POST via captured scope with observed role and no demo branch',async()=>{
 const prepare=nodes(tree,node=>ts.isFunctionDeclaration(node)&&node.name?.text==='PrepareGoal')[0];assert.ok(prepare);
 const submit=nodes(prepare,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='submit')[0].initializer;
 const calls=[],intent={expected_preparation_revision:'a'.repeat(64)},result={creadas:1,vinculadas:0};
 const scope={current:()=>true,assertCurrent(){},request:async(url,options)=>{calls.push({url,options});return result}};
 const deps={pending:{current:false},reviewBlocked:{current:false},capture:()=>scope,captureLifetime:()=>scope,reconciling:false,
  client:{preparado:false},period:'2026-10',formats:{video:[7]},accounts:{},view:{role:'community'},acknowledged:true,
  goalPreparationBody:args=>{assert.equal(args.role,'community');assert.equal(args.acknowledged,true);return intent},
  goalQuotaReviewBody:()=>assert.fail('Normal preparation must not reconcile'),verifiedGoalPreparationAck:value=>{assert.equal(value,result);return value},
  saved:value=>assert.equal(value,result),setBusy(){},setError(){},setBlocked(){},isSessionFailure:()=>false};
 await evaluate(submit,deps)({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/cliente-objetivos/preparar');assert.equal(calls[0].options.method,'POST');
 assert.equal(calls[0].options.body,JSON.stringify(intent));assert.equal(deps.reviewBlocked.current,true);assert.equal(deps.pending.current,false);
});
