import { inject } from 'tglessjs';
import { gt } from 'tglessjs/db';
import { SHOP_CONFIG } from '../../../config';
import { Products, type Product } from '../entities/product.entity';

export class CatalogService {
  private config = inject(SHOP_CONFIG);

  page(page: number) {
    return Products.paginate({
      where: { active: true, stock: gt(0) },
      orderBy: { id: 'asc' },
      page,
      perPage: this.config.pageSize,
    });
  }

  get(id: number) {
    return Products.find({ id, active: true });
  }

  add(data: { title: string; price: number; stock: number; description?: string }) {
    return Products.create(data);
  }

  price(p: Pick<Product, 'price'>) {
    return `${p.price.toFixed(2)} ${this.config.currency}`;
  }
}
