/* Transporte Supabase. No almacena copias del libro contable en el navegador. */
(function(root){
  'use strict';
  class ScaffidiRemote {
    constructor(sdk,config){
      this.client=sdk.createClient(config.url,config.key,{auth:{storageKey:'scaffidi.supabase.auth.v2',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      this.channel=null;
    }
    static failure(error){
      const message=String(error?.message||'');
      const e=new Error(message||'No se pudo completar la operación.');
      e.code=error?.code||'';
      if(e.code==='40001'||message.includes('STALE_REVISION')){e.kind='stale';e.message='Otra computadora actualizó los datos. Actualizá la pantalla y revisá la operación antes de volver a confirmar.';}
      else if(e.code==='42501'||message.includes('ACCOUNT_NOT_AUTHORIZED')){e.kind='unauthorized';e.message='Esta cuenta no está autorizada para administrar el consorcio. Revisá el alta de usuarios en Supabase.';}
      else if(['PGRST202','PGRST205','42P01','42883'].includes(e.code)){e.kind='setup';e.message='Falta instalar el esquema de Scaffidi en Supabase. Ejecutá 001_esquema.sql y 002_administrador.sql.';}
      else if(!e.code||/fetch|network|timeout|connection/i.test(message)){e.kind='network';e.message='No se pudo confirmar la respuesta del servidor. Conservá este formulario y reintentá: la misma operación no se registra dos veces.';}
      else if(e.code==='23505'){e.kind='validation';e.message='Ya existe un registro con esa unidad, período o número. Actualizá los datos antes de continuar.';}
      else{e.kind='validation';}
      return e;
    }
    async rpc(name,args){
      try{const {data,error}=await this.client.rpc(name,args);if(error)throw ScaffidiRemote.failure(error);return data;}
      catch(error){throw error.kind?error:ScaffidiRemote.failure(error);}
    }
    read(){return this.rpc('scaffidi_read');}
    revision(){return this.rpc('scaffidi_revision');}
    async command(action,payload,revision,requestId){
      // The exact request ID and payload survive both automatic and manual retry.
      const args={p_request_id:requestId,p_revision:revision,p_action:action,p_payload:JSON.parse(JSON.stringify(payload))};
      try{return await this.rpc('scaffidi_command',args);}
      catch(error){if(error.kind!=='network')throw error;await new Promise(resolve=>setTimeout(resolve,600));return this.rpc('scaffidi_command',args);}
    }
    async session(){const {data,error}=await this.client.auth.getSession();if(error)throw error;return data.session;}
    async signIn(email,password){const {data,error}=await this.client.auth.signInWithPassword({email,password});if(error)throw new Error('No pudimos iniciar sesión. Revisá el correo, la contraseña y la conexión.');return data.session;}
    async signOut(){this.stop();const {error}=await this.client.auth.signOut({scope:'local'});if(error)throw error;}
    async role(userId){const {data,error}=await this.client.from('scaffidi_members').select('role,active').eq('user_id',userId).single();if(error||!data?.active)throw ScaffidiRemote.failure({code:'42501'});return data.role;}
    onAuth(callback){return this.client.auth.onAuthStateChange((event,session)=>{setTimeout(()=>callback(event,session),0);});}
    subscribe(onRevision,onStatus){
      this.stop();
      this.channel=this.client.channel('scaffidi-book-'+Math.random().toString(36).slice(2))
        .on('postgres_changes',{event:'UPDATE',schema:'public',table:'scaffidi_book',filter:'id=eq.1'},payload=>onRevision(Number(payload.new.revision)))
        .subscribe(onStatus);
    }
    stop(){if(this.channel){this.client.removeChannel(this.channel);this.channel=null;}}
  }
  root.ScaffidiRemote=ScaffidiRemote;
})(globalThis);
