import {createReport,filterReports,toggleArchived} from './model.mjs';
import {renderReports} from './view.mjs';
let reports=[{id:1,title:'Revenue overview',period:'Monthly',status:'ready',archived:false},{id:2,title:'Guest sentiment',period:'Quarterly',status:'draft',archived:false},{id:3,title:'Channel performance',period:'Monthly',status:'ready',archived:false}];
const $=id=>document.getElementById(id);
function render(){ const visible=filterReports(reports,{query:$('search').value,status:$('status').value,includeArchived:$('include-archived').checked}); $('reports').innerHTML=renderReports(visible);$('count').textContent=`${visible.length} reports`; }
$('create-form').addEventListener('submit',event=>{event.preventDefault();try{reports=createReport(reports,{title:$('title').value,period:$('period').value});$('form-error').textContent='';$('title').value='';render();}catch(error){$('form-error').textContent=error.message;}});
$('search').addEventListener('input',render);$('status').addEventListener('change',render);$('include-archived').addEventListener('change',render);
$('reports').addEventListener('click',event=>{const button=event.target.closest('button[data-action="archive"]');if(button){reports=toggleArchived(reports,Number(button.dataset.id));render();}});
render();
