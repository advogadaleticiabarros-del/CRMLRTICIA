const os=require("os"),fs=require("fs"),path=require("path"),zlib=require("zlib");
const mysqldump=require("mysqldump");
(async()=>{
  try{
    let t=Date.now();
    const tmp=path.join(os.tmpdir(),"crm-bktest.sql");
    // dump SEM compressFile (plain SQL)
    await mysqldump({ connection:{host:"127.0.0.1",port:3306,database:"crm_juridico",user:"root",password:""}, dumpToFile:tmp });
    const sql=fs.readFileSync(tmp);
    console.log("DUMP plain OK em "+((Date.now()-t)/1000).toFixed(1)+"s, "+Math.round(sql.length/1024)+" KB");
    // gzip com zlib (confiavel)
    const gz=zlib.gzipSync(sql);
    console.log("GZIP OK -> "+Math.round(gz.length/1024)+" KB comprimido");
    console.log("RESULTADO: abordagem dump-plain + zlib FUNCIONA");
    process.exit(0);
  }catch(e){ console.log("ERRO: "+e.message); process.exit(1); }
})();
