import {SYSTEM_USER_ROLES} from './user-roles.js';
const validId=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const denied=()=>Object.assign(new Error('La sesión ya no está activa.'),{status:401});
export async function loadProductionCatalog(pool,auth){
 const id=auth?.id,role=auth?.rol,version=auth?.session_version;
 if(!validId(id)||!validId(version)||typeof role!=='string')throw denied();
 const {rows}=await pool.query(`WITH actor AS (
   SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1
 ) SELECT a.*,
   CASE WHEN a.activo IS TRUE AND a.rol=$2 AND a.session_version=$3 AND a.rol::text=ANY($4::text[])
    THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',u.id,'nombre',u.nombre,'rol',u.rol,'activo',u.activo) ORDER BY u.nombre,u.id),'[]'::jsonb) FROM usuarios u WHERE u.activo IS TRUE)
    ELSE '[]'::jsonb END AS usuarios,
   CASE WHEN a.activo IS TRUE AND a.rol=$2 AND a.session_version=$3 AND a.rol::text=ANY($4::text[])
    THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'activo',c.activo) ORDER BY c.nombre,c.id),'[]'::jsonb) FROM clientes c)
    ELSE '[]'::jsonb END AS clientes FROM actor a`,[id,role,version,SYSTEM_USER_ROLES]);
 const actor=rows[0];
 if(!actor||actor.id!==id||actor.activo!==true||actor.rol!==role||actor.session_version!==version)throw denied();
 if(!SYSTEM_USER_ROLES.includes(actor.rol))throw Object.assign(new Error('Perfil no autorizado.'),{status:403});
 if(!Array.isArray(actor.usuarios)||!Array.isArray(actor.clientes))throw new Error('Catálogo de producción inválido.');
 return {usuarios:actor.usuarios,clientes:actor.clientes};
}
