import { NgModule } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { FormsModule } from "@angular/forms";
import { HttpClientModule } from "@angular/common/http";

import { AppComponent } from "./app.component";
import { ChatComponent } from "./chat/chat.component";
import { GoalSummaryComponent } from "./goal-summary/goal-summary.component";

@NgModule({
  declarations: [AppComponent, ChatComponent, GoalSummaryComponent],
  imports: [BrowserModule, FormsModule, HttpClientModule],
  bootstrap: [AppComponent],
})
export class AppModule {}
