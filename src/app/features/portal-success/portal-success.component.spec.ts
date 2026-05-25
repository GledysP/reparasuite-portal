import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PortalSuccessComponent } from './portal-success.component';

describe('PortalSuccessComponent', () => {
  let component: PortalSuccessComponent;
  let fixture: ComponentFixture<PortalSuccessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PortalSuccessComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PortalSuccessComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
