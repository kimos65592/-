package com.ahmed.electricitysmart

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.max

data class Reading(val date: String, val meter: Double, val balance: Double?)
data class TopUp(val date: String, val amount: Double)
data class Tariff(val label: String, val max: Double, val price: Double, val service: Double)

object Tariffs {
    val official = listOf(
        Tariff("0–50", 50.0, .68, 1.0),
        Tariff("51–100", 100.0, .78, 2.0),
        Tariff("101–200", 200.0, .95, 6.0),
        Tariff("201–350", 350.0, 1.55, 11.0),
        Tariff("351–650", 650.0, 1.95, 15.0),
        Tariff("651–1000", 1000.0, 2.10, 25.0),
        Tariff(">1000", Double.POSITIVE_INFINITY, 2.58, 40.0)
    )
}

class Store(c: Context) {
    private val p = c.getSharedPreferences("electricity_smart", Context.MODE_PRIVATE)
    fun readings(): MutableList<Reading> {
        val a = JSONArray(p.getString("readings", "[]")); val out = mutableListOf<Reading>()
        for (i in 0 until a.length()) {
            val o = a.getJSONObject(i)
            out += Reading(o.getString("date"), o.getDouble("meter"),
                if (o.isNull("balance")) null else o.getDouble("balance"))
        }
        return out
    }
    fun topups(): MutableList<TopUp> {
        val a = JSONArray(p.getString("topups", "[]")); val out = mutableListOf<TopUp>()
        for (i in 0 until a.length()) { val o=a.getJSONObject(i); out += TopUp(o.getString("date"),o.getDouble("amount")) }
        return out
    }
    fun saveReadings(list: List<Reading>) {
        val a=JSONArray(); list.forEach { r -> a.put(JSONObject().apply {
            put("date",r.date); put("meter",r.meter); if(r.balance==null) put("balance",JSONObject.NULL) else put("balance",r.balance)
        })}; p.edit().putString("readings",a.toString()).apply()
    }
    fun saveTopups(list: List<TopUp>) {
        val a=JSONArray(); list.forEach { t -> a.put(JSONObject().apply { put("date",t.date); put("amount",t.amount) }) }
        p.edit().putString("topups",a.toString()).apply()
    }
}

fun cost(kwh: Double): Double {
    var prev=0.0; var total=0.0
    for(t in Tariffs.official) {
        val used=max(0.0,minOf(kwh,t.max)-prev); total += used*t.price; prev=t.max
        if(kwh<=t.max) return total+t.service
    }
    return total+Tariffs.official.last().service
}
fun money(x:Double)=String.format(Locale.US,"%.2f جنيه",x)
fun today()=SimpleDateFormat("yyyy-MM-dd",Locale.US).format(Date())
fun day(s:String)=SimpleDateFormat("yyyy-MM-dd",Locale.US).parse(s)?.time ?: 0L

@Composable
fun App() {
    val context=androidx.compose.ui.platform.LocalContext.current
    val store=remember{Store(context)}
    var readings by remember{mutableStateOf(store.readings().sortedBy{it.date})}
    var topups by remember{mutableStateOf(store.topups().sortedBy{it.date})}
    var tab by remember{mutableIntStateOf(0)}
    var addR by remember{mutableStateOf(false)}
    var addT by remember{mutableStateOf(false)}
    val daily=if(readings.size<2)0.0 else {
        val a=readings.last(); val b=readings[readings.lastIndex-1]
        max(0.0,a.meter-b.meter)/max(1.0,(day(a.date)-day(b.date))/86400000.0)
    }
    val month=daily*30; val estimate=cost(month)
    MaterialTheme(colorScheme=darkColorScheme(primary=Color(0xFF4EA1FF),secondary=Color(0xFF63D6A3))) {
        Scaffold(topBar={TopAppBar(title={Text("⚡ عداد الكهرباء الذكي")})},
            bottomBar={NavigationBar{
                NavigationBarItem(tab==0,{tab=0},{Text("🏠")} ,label={Text("الرئيسية")})
                NavigationBarItem(tab==1,{tab=1},{Text("📊")} ,label={Text("التحليل")})
                NavigationBarItem(tab==2,{tab=2},{Text("⚙️")} ,label={Text("الإعدادات")})
            }}) { pad ->
            when(tab){
                0->Home(Modifier.padding(pad),readings,daily,month,estimate,{addR=true},{addT=true})
                1->Analysis(Modifier.padding(pad),readings,topups,month,estimate)
                else->Settings(Modifier.padding(pad))
            }
        }
        if(addR) ReadingDialog({addR=false}){d,m,b->
            val n=readings.toMutableList().apply{removeAll{it.date==d};add(Reading(d,m,b))}.sortedBy{it.date}
            readings=n;store.saveReadings(n);addR=false
        }
        if(addT) TopupDialog({addT=false}){d,a->
            val n=topups.toMutableList().apply{add(TopUp(d,a))}.sortedBy{it.date}
            topups=n;store.saveTopups(n);addT=false
        }
    }
}

@Composable fun Home(mod:Modifier, readings:List<Reading>, daily:Double, month:Double, estimate:Double, addR:()->Unit, addT:()->Unit){
    LazyColumn(mod.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        item{Card{Column(Modifier.padding(16.dp)){Text("آخر رصيد مسجل");Text(readings.lastOrNull()?.balance?.let(::money)?:"—",style=MaterialTheme.typography.headlineMedium)}}}
        item{Card{Column(Modifier.padding(16.dp)){Text("متوسط الاستهلاك اليومي");Text(if(daily>0)"%.2f ك.و.س".format(daily) else "—")}}}
        item{Card{Column(Modifier.padding(16.dp)){Text("توقع 30 يومًا");Text(if(month>0)"%.2f ك.و.س".format(month) else "—");Text("التكلفة التقديرية: ${if(month>0)money(estimate) else "—"}")}}}
        item{Button(addR,Modifier.fillMaxWidth()){Text("➕ تسجيل قراءة")}}
        item{OutlinedButton(addT,Modifier.fillMaxWidth()){Text("💳 تسجيل شحنة")}}
    }
}
@Composable fun Analysis(mod:Modifier, readings:List<Reading>, topups:List<TopUp>, month:Double, estimate:Double){
    LazyColumn(mod.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        item{Text("التحليل",style=MaterialTheme.typography.headlineSmall)}
        item{Text("الاستهلاك المتوقع: %.2f ك.و.س".format(month))}
        item{Text("التكلفة التقديرية: ${money(estimate)}")}
        item{Text("إجمالي الشحنات: ${money(topups.sumOf{it.amount})}")}
        item{Text("عدد القراءات: ${readings.size}")}
        items(readings.size){i->val r=readings[i];val d=if(i==0)null else r.meter-readings[i-1].meter;Text("${r.date}: ${r.meter} ك.و.س"+(d?.let{" | +%.2f".format(it)}?:""))}
    }
}
@Composable fun Settings(mod:Modifier){
    LazyColumn(mod.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        item{Text("الإعدادات",style=MaterialTheme.typography.headlineSmall)}
        item{Text("أوفلاين: البيانات محفوظة محليًا ولا يوجد حساب أو API أو سيرفر.")}
        item{Text("التعريفة الافتراضية: الاستخدام المنزلي في مصر، بدءًا من أبريل 2026.")}
        item{Text("يمكن إضافة تعديل يدوي للتعريفة لاحقًا من إعدادات متقدمة، مع حفظ تاريخ المصدر والتعريفة القديمة.")}
    }
}
@Composable fun ReadingDialog(dismiss:()->Unit, save:(String,Double,Double?)->Unit){
    var d by remember{mutableStateOf(today())};var m by remember{mutableStateOf("")};var b by remember{mutableStateOf("")}
    AlertDialog(onDismissRequest=dismiss,title={Text("تسجيل قراءة")},text={Column{TextField(d,{d=it},label={Text("التاريخ")});TextField(m,{m=it},label={Text("القراءة التراكمية ك.و.س")});TextField(b,{b=it},label={Text("الرصيد جنيه - اختياري")})}},
        confirmButton={Button({m.toDoubleOrNull()?.let{save(d,it,b.toDoubleOrNull())}}){Text("حفظ")}},dismissButton={TextButton(dismiss){Text("إلغاء")}})
}
@Composable fun TopupDialog(dismiss:()->Unit, save:(String,Double)->Unit){
    var a by remember{mutableStateOf("")}
    AlertDialog(onDismissRequest=dismiss,title={Text("تسجيل شحنة")},text={TextField(a,{a=it},label={Text("قيمة الشحنة بالجنيه")})},
        confirmButton={Button({a.toDoubleOrNull()?.let{save(today(),it)}}){Text("حفظ")}},dismissButton={TextButton(dismiss){Text("إلغاء")}})
}
class MainActivity:ComponentActivity(){override fun onCreate(b:Bundle?){super.onCreate(b);setContent{App()}}}
